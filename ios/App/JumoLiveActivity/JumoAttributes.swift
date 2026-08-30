import Foundation
import ActivityKit

// 라이브 액티비티가 주고받는 데이터.
// 앱(시작)과 서버 푸시(갱신)가 같은 구조를 쓰므로, 서버의 content-state JSON
// 키 이름이 여기 프로퍼티명과 정확히 일치해야 한다.
struct JumoMatchAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var homeScore: Int
        var awayScore: Int
        var minute: String        // "34'", "HT", "FT" 등 이미 표시용으로 만들어 보낸다
        var status: String        // live | halftime | final
        // 우리 선수 기록 — 없으면 빈 값으로 두고 화면에서 숨긴다
        var playerLine: String    // "선발 · 34분" / "1골 1도움" / "벤치"
        var playerGoals: Int
        var playerAssists: Int
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
