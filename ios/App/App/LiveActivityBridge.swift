import Foundation
import ActivityKit
import Capacitor

// 웹(JS)에서 라이브 액티비티를 켜고/끄고/갱신하게 해주는 다리.
//
// 왜 네이티브인가: 라이브 액티비티 화면은 SwiftUI 로만 만들 수 있고 OTA 로 못 나간다.
// 대신 '언제 시작할지'는 경기 데이터를 아는 웹 쪽이 판단하는 게 자연스러워서,
// 판단은 JS, 표시는 네이티브로 나눴다.
//
// 서버 푸시로 갱신하려면 activity.pushToken 이 필요하다. 시작 직후 토큰이
// 발급되므로 받아서 웹으로 넘기고, 웹이 Supabase 에 저장해 크론이 쓴다.
// ActivityContent / update / end 시그니처가 16.2 부터라 16.2 를 요구한다.
// (위젯 UI 자체는 16.1 에서도 동작하므로 익스텐션 타깃은 16.1 로 둔다.)
@available(iOS 16.2, *)
final class LiveActivityBridge {
    static let shared = LiveActivityBridge()
    private var current: Activity<JumoMatchAttributes>?
    private var currentMatchId: String?
    private var tokenTask: Task<Void, Never>?

    /// 웹에서 넘어온 dict 로 액티비티를 시작한다. 이미 같은 경기면 갱신만 한다.
    func start(_ d: [String: Any], onToken: @escaping (String, String) -> Void) -> String? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return "disabled" }
        let matchId = d["matchId"] as? String ?? ""
        if currentMatchId == matchId, current != nil {
            update(d); return nil
        }
        endCurrent()

        let attrs = JumoMatchAttributes(
            homeName: d["homeName"] as? String ?? "",
            awayName: d["awayName"] as? String ?? "",
            homeAbbr: d["homeAbbr"] as? String ?? "",
            awayAbbr: d["awayAbbr"] as? String ?? "",
            playerName: d["playerName"] as? String ?? "",
            playerNumber: d["playerNumber"] as? Int ?? 0,
            competition: d["competition"] as? String ?? ""
        )
        let state = Self.state(from: d)

        do {
            let act = try Activity.request(
                attributes: attrs,
                content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(3 * 3600)),
                pushType: .token)
            current = act
            currentMatchId = matchId
            // 푸시 토큰은 비동기로 온다 — 받는 즉시 웹에 넘겨 서버에 저장하게 한다.
            tokenTask?.cancel()
            tokenTask = Task {
                for await data in act.pushTokenUpdates {
                    let hex = data.map { String(format: "%02x", $0) }.joined()
                    onToken(matchId, hex)
                }
            }
            return nil
        } catch {
            return "\(error)"
        }
    }

    func update(_ d: [String: Any]) {
        guard let act = current else { return }
        let state = Self.state(from: d)
        Task { await act.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(3 * 3600))) }
    }

    func end() { endCurrent() }

    private func endCurrent() {
        tokenTask?.cancel(); tokenTask = nil
        guard let act = current else { return }
        current = nil; currentMatchId = nil
        Task { await act.end(nil, dismissalPolicy: .immediate) }
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
