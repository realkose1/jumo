import Foundation
import ActivityKit
import Capacitor

// 웹(JS)에서 라이브 액티비티를 켜고/끄고/갱신하게 해주는 다리.
//
// 왜 네이티브인가: 라이브 액티비티 화면은 SwiftUI 로만 만들 수 있고 OTA 로 못 나간다.
// 대신 '언제 시작할지'는 경기 데이터를 아는 웹 쪽이 판단하는 게 자연스러워서,
// 판단은 JS, 표시는 네이티브로 나눴다.
//
// 여러 경기를 동시에 띄운다(웹이 개수를 정한다 — 현재 최대 3). 그래서 상태는
// matchId 를 키로 하는 딕셔너리로 들고, 웹이 보내는 `sync` 한 방으로
// "지금 떠 있어야 할 목록" 전체를 맞춘다 — 목록에 있으면 시작/갱신, 없으면 종료.
//
// 서버 푸시로 갱신하려면 activity.pushToken 이 필요하다. 시작 직후 토큰이
// 발급되므로 받아서 웹으로 넘기고, 웹이 Supabase 에 저장해 크론이 쓴다.
// ActivityContent / update / end 시그니처가 16.2 부터라 16.2 를 요구한다.
// (위젯 UI 자체는 16.1 에서도 동작하므로 익스텐션 타깃은 16.1 로 둔다.)
@available(iOS 16.2, *)
final class LiveActivityBridge {
    static let shared = LiveActivityBridge()
    /// matchId → 지금 떠 있는 액티비티.
    private var activities: [String: Activity<JumoMatchAttributes>] = [:]
    /// matchId → 푸시 토큰 관찰 Task. 종료할 때 그 경기 것만 취소한다.
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    /// 로고를 내려받는 중이라 아직 Activity.request 전인 경기. 중복 요청을 막는다.
    private var starting: Set<String> = []
    /// 시작이 진행 중일 때 들어온 최신 payload. 로고를 받는 동안 점수가 바뀔 수
    /// 있으므로, 요청 직전에 가장 최근 값을 쓴다.
    private var pending: [String: [String: Any]] = [:]

    // MARK: - 액션

    /// 웹이 "지금 띄워야 할 경기 목록 전체"를 한 번에 보낸다.
    /// 목록에 있으면 시작(또는 갱신), 목록에 없는 살아있는 카드는 끝낸다.
    /// 빈 목록을 보내면 전부 내려간다.
    @discardableResult
    func sync(_ list: [[String: Any]], onToken: @escaping (String, String) -> Void) -> String? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "disabled" }
        adoptAlive(onToken: onToken)

        var desired = Set<String>()
        for d in list {
            let matchId = d["matchId"] as? String ?? ""
            guard !matchId.isEmpty else { continue }
            desired.insert(matchId)
            upsert(d, matchId: matchId, onToken: onToken)
        }

        // 목록에서 빠진 것 = 끝난 경기이거나 지난 경기의 잔재. 여기서 정리한다.
        // (adopt 를 먼저 했으므로 앱 재시작 전에 띄운 것도 이 대상에 들어온다.)
        for matchId in Array(activities.keys) where !desired.contains(matchId) {
            endMatch(matchId)
        }
        for matchId in Array(starting) where !desired.contains(matchId) {
            // 아직 request 전이면 자리만 비우면 된다 — 로고 Task 가 깨어나
            // starting 검사에 걸려 스스로 취소된다.
            starting.remove(matchId)
            pending[matchId] = nil
        }
        return nil
    }

    /// 옛 OTA 번들 호환 — 경기 하나를 시작/갱신한다. "그 경기 하나만 sync" 와 같되,
    /// 목록을 모르므로 다른 액티비티는 건드리지 않는다(무엇이 잔재인지 알 수 없다).
    @discardableResult
    func start(_ d: [String: Any], onToken: @escaping (String, String) -> Void) -> String? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "disabled" }
        let matchId = d["matchId"] as? String ?? ""
        guard !matchId.isEmpty else { return nil }
        adoptAlive(onToken: onToken)
        upsert(d, matchId: matchId, onToken: onToken)
        return nil
    }

    /// 점수·분 갱신. 옛 번들의 `update` 액션도 여기로 온다.
    func update(_ d: [String: Any]) {
        let matchId = d["matchId"] as? String ?? ""
        guard !matchId.isEmpty else { return }
        // 앱 재시작 직후엔 딕셔너리가 비어 있을 수 있다 — 살아있는 카드를 직접 찾는다.
        if let act = activities[matchId]
            ?? Activity<JumoMatchAttributes>.activities.first(where: { $0.attributes.matchId == matchId }) {
            activities[matchId] = act
            push(act, d)
            return
        }
        // 아직 시작 중(로고 내려받는 중)이면 최신 값만 남겨두고 빠진다.
        if starting.contains(matchId) { pending[matchId] = d }
    }

    /// 전부 종료(설정에서 라이브 액티비티를 껐을 때).
    func end() {
        for task in tokenTasks.values { task.cancel() }
        tokenTasks.removeAll()
        pending.removeAll()
        starting.removeAll()
        activities.removeAll()
        // 딕셔너리만 비우면 재시작 전에 띄운 것들이 잠금화면에 남는다.
        for act in Activity<JumoMatchAttributes>.activities {
            Task { await act.end(nil, dismissalPolicy: .immediate) }
        }
    }

    // MARK: - 내부

    /// 앱이 재시작되면 딕셔너리 참조가 사라진다. 그대로 request 하면 이미 떠 있는
    /// 카드 위에 한 장이 더 얹혀, 잠금화면에 같은 경기가 계속 쌓인다
    /// (실측: 하프타임·54'·59'·61' 네 장). 살아있는 액티비티를 다시 붙잡는다.
    private func adoptAlive(onToken: @escaping (String, String) -> Void) {
        for act in Activity<JumoMatchAttributes>.activities {
            let matchId = act.attributes.matchId
            if let known = activities[matchId] {
                // 같은 경기 카드가 둘이면 한 장은 잔재다 — 즉시 정리한다.
                if known.id != act.id { Task { await act.end(nil, dismissalPolicy: .immediate) } }
                continue
            }
            guard !matchId.isEmpty else { continue }
            activities[matchId] = act
            observeToken(act, matchId: matchId, onToken: onToken)
        }
    }

    /// 있으면 갱신, 없으면 시작.
    ///
    /// 엠블럼은 위젯이 직접 받을 수 없어서(네트워크·비동기 불가) 여기서 먼저
    /// 내려받아 App Group 에 캐시한 뒤, 그 파일명을 attributes 에 실어 시작한다.
    /// attributes 는 시작 후 못 바꾸므로 순서가 바뀌면 로고가 영영 안 붙는다.
    private func upsert(_ d: [String: Any], matchId: String,
                        onToken: @escaping (String, String) -> Void) {
        if let act = activities[matchId] { push(act, d); return }
        if starting.contains(matchId) { pending[matchId] = d; return }

        starting.insert(matchId)   // 로고 받는 동안 중복 요청을 막는다
        pending[matchId] = d
        Task { [weak self] in
            let home = await JumoLogoStore.cache(d["homeLogo"] as? String ?? "")
            let away = await JumoLogoStore.cache(d["awayLogo"] as? String ?? "")
            await MainActor.run {
                guard let self, self.starting.contains(matchId), self.activities[matchId] == nil else { return }
                self.request(self.pending[matchId] ?? d, matchId: matchId,
                             homeLogoFile: home, awayLogoFile: away, onToken: onToken)
                self.starting.remove(matchId)
                self.pending[matchId] = nil
            }
        }
    }

    private func request(_ d: [String: Any], matchId: String,
                         homeLogoFile: String, awayLogoFile: String,
                         onToken: @escaping (String, String) -> Void) {
        let attrs = JumoMatchAttributes(
            homeName: d["homeName"] as? String ?? "",
            awayName: d["awayName"] as? String ?? "",
            homeAbbr: d["homeAbbr"] as? String ?? "",
            awayAbbr: d["awayAbbr"] as? String ?? "",
            playerName: d["playerName"] as? String ?? "",
            playerNumber: d["playerNumber"] as? Int ?? 0,
            competition: d["competition"] as? String ?? "",
            matchId: matchId,
            homeLogoFile: homeLogoFile,
            awayLogoFile: awayLogoFile
        )
        let state = Self.state(from: d)

        do {
            let act = try Activity.request(
                attributes: attrs,
                content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(3 * 3600)),
                pushType: .token)
            activities[matchId] = act
            observeToken(act, matchId: matchId, onToken: onToken)
        } catch {
            // 시작에 실패했으면 자리를 비워둬야 다음 시도가 막히지 않는다.
            activities[matchId] = nil
        }
    }

    private func push(_ act: Activity<JumoMatchAttributes>, _ d: [String: Any]) {
        let state = Self.state(from: d)
        Task { await act.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(3 * 3600))) }
    }

    /// 푸시 토큰은 비동기로 온다 — 받는 즉시 웹에 넘겨 서버에 저장하게 한다.
    /// 경기마다 토큰이 따로 있으므로 Task 도 matchId 별로 들고 있는다.
    private func observeToken(_ act: Activity<JumoMatchAttributes>, matchId: String,
                              onToken: @escaping (String, String) -> Void) {
        tokenTasks[matchId]?.cancel()
        tokenTasks[matchId] = Task {
            for await data in act.pushTokenUpdates {
                let hex = data.map { String(format: "%02x", $0) }.joined()
                onToken(matchId, hex)
            }
        }
    }

    /// 한 경기만 끝낸다 — 다른 경기의 카드·토큰 관찰은 그대로 둔다.
    private func endMatch(_ matchId: String) {
        tokenTasks[matchId]?.cancel()
        tokenTasks[matchId] = nil
        pending[matchId] = nil
        starting.remove(matchId)
        if let act = activities.removeValue(forKey: matchId) {
            Task { await act.end(nil, dismissalPolicy: .immediate) }
        }
    }

    private static func state(from d: [String: Any]) -> JumoMatchAttributes.ContentState {
        JumoMatchAttributes.ContentState(
            homeScore: d["homeScore"] as? Int ?? 0,
            awayScore: d["awayScore"] as? Int ?? 0,
            minute: d["minute"] as? String ?? "",
            status: d["status"] as? String ?? "live",
            playerLine: d["playerLine"] as? String ?? "",
            playerGoals: d["playerGoals"] as? Int ?? 0,
            playerAssists: d["playerAssists"] as? Int ?? 0
        )
    }
}
