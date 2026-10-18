import Foundation
import ActivityKit

// 라이브 액티비티가 주고받는 데이터.
// 앱(시작)과 서버 푸시(갱신)가 같은 구조를 쓰므로, 서버의 content-state JSON
// 키 이름이 여기 프로퍼티명과 정확히 일치해야 한다.
struct JumoMatchAttributes: ActivityAttributes {
    // 이 경기에 나선 우리 선수 한 명의 상태(코리안 더비면 여러 명).
    // 앱(index.html 라이브 액티비티 sync 의 players)과 서버(api/push-cron.js 의 players)가
    // 같은 모양·같은 어휘(liveActivityLine: 선발 출전/교체 출전/교체 아웃/벤치/'')로 보낸다.
    public struct PlayerState: Codable, Hashable {
        var name: String          // 앱 표시 이름(한글) — attributes.playerName 과 이걸로 맞춘다
        var line: String
        var goals: Int
        var assists: Int
    }

    public struct ContentState: Codable, Hashable {
        var homeScore: Int
        var awayScore: Int
        var minute: String        // "34'", "HT", "FT" 등 이미 표시용으로 만들어 보낸다
        var status: String        // live | halftime | final
        // 우리 선수 기록 — 없으면 빈 값으로 두고 화면에서 숨긴다
        var playerLine: String    // "선발 · 34분" / "1골 1도움" / "벤치"
        var playerGoals: Int
        var playerAssists: Int
        // 이 경기의 우리 선수 전원(더비 대비). 없으면(옛 앱 번들·옛 서버) nil — 위 단일
        // 선수 필드로 그린다. 옵셔널이라 이 키가 없는 페이로드도 그대로 디코딩되고,
        // 옛 빌드는 모르는 키를 무시한다.
        var players: [PlayerState]? = nil
    }

    // 경기 중 변하지 않는 값
    var homeName: String
    var awayName: String
    var homeAbbr: String
    var awayAbbr: String
    var playerName: String
    var playerNumber: Int
    var competition: String
    // 앱이 재시작돼도 이미 떠 있는 액티비티를 다시 찾아 붙잡기 위한 열쇠.
    var matchId: String = ""
    // App Group 에 캐시된 엠블럼 파일명. 비어 있으면 위젯이 약칭 배지로 대체한다.
    var homeLogoFile: String = ""
    var awayLogoFile: String = ""
}

// 서버 푸시의 content-state 는 하나라도 디코딩에 실패하면 갱신 전체가 조용히 버려진다.
// 선수 항목에 키가 빠지거나 타입이 어긋나도 갱신 자체는 살도록 빈 값으로 채운다.
// (extension 에 둬서 멤버와이즈 init 은 그대로 남긴다.)
extension JumoMatchAttributes.PlayerState {
    private enum CodingKeys: String, CodingKey { case name, line, goals, assists }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? ""
        line = (try? c.decodeIfPresent(String.self, forKey: .line)) ?? ""
        goals = (try? c.decodeIfPresent(Int.self, forKey: .goals)) ?? 0
        assists = (try? c.decodeIfPresent(Int.self, forKey: .assists)) ?? 0
    }
}
