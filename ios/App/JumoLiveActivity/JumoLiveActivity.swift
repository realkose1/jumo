import SwiftUI
import WidgetKit
import UIKit
import ActivityKit

// 브랜드 옐로 — 앱의 --acc 와 같은 값.
private let acc = Color(red: 0.961, green: 0.769, blue: 0.0)

// 이 카드의 주인공과 같은 경기의 다른 우리 선수(코리안 더비).
// 주인공 = 앱이 액티비티를 시작할 때 고른 선수(attributes.playerName, 시작 후 못 바꾼다).
// 상태는 players(앱 sync · 서버 푸시가 경기의 우리 선수 전원을 싣는다)에서 이름으로 찾고,
// 없으면(옛 앱 번들·옛 서버라 players 가 없음) 예전 단일 선수 필드로 그린다.
private struct MatchPlayers {
    let main: JumoMatchAttributes.PlayerState
    let others: [JumoMatchAttributes.PlayerState]

    init(_ ctx: ActivityViewContext<JumoMatchAttributes>) {
        let name = ctx.attributes.playerName
        let list = ctx.state.players ?? []
        main = list.first { $0.name == name }
            ?? JumoMatchAttributes.PlayerState(name: name,
                                               line: ctx.state.playerLine,
                                               goals: ctx.state.playerGoals,
                                               assists: ctx.state.playerAssists)
        others = list.filter { $0.name != name && Self.played($0) }
    }

    // 실제로 그라운드를 밟은 선수만 곁들인다 — 벤치·미출전·모름('')은 뺀다.
    // (선발 출전 / 교체 출전 / 교체 아웃, 야구 스탯 라인, 또는 골·도움이 있으면 출전)
    static func played(_ p: JumoMatchAttributes.PlayerState) -> Bool {
        if p.goals > 0 || p.assists > 0 { return true }
        let l = p.line.trimmingCharacters(in: .whitespaces)
        return !l.isEmpty && !l.contains("벤치") && !l.contains("미출전")
    }
}

// 우리 선수 기록 한 줄. 골·도움이 있으면 강조하고, 없으면 출전 상태만 담담히.
// 더비면 주인공 뒤에 '· 이름 상태'로 다른 선수를 잇는다.
private struct PlayerLine: View {
    let name: String
    let number: Int
    let line: String
    let goals: Int
    let assists: Int
    var others: [JumoMatchAttributes.PlayerState] = []
    // 경기가 끝나면 상태 문구는 숨긴다('종료'인데 '선발 출전'이 남지 않게 — 서버가 예전부터
    // 종료 시 playerLine 을 비우던 것과 같은 뜻). 골·도움 배지와 다른 선수 이름은 그대로.
    var showLine = true
    var compact = false

    var body: some View {
        HStack(spacing: 5) {
            Text("🇰🇷").font(.system(size: compact ? 10 : 12))
            Text(name)
                .font(.system(size: compact ? 11 : 13, weight: .bold))
                .foregroundStyle(acc)
                .lineLimit(1).fixedSize()
            if goals > 0 || assists > 0 {
                // 기록이 있으면 그게 핵심이다 — 배지로 띄운다.
                HStack(spacing: 3) {
                    if goals > 0 { Text("⚽\(goals)").font(.system(size: compact ? 10 : 12, weight: .heavy)) }
                    if assists > 0 { Text("🅰️\(assists)").font(.system(size: compact ? 10 : 12, weight: .heavy)) }
                }
                .foregroundStyle(acc)
            } else if showLine && !line.isEmpty {
                Text(line)
                    .font(.system(size: compact ? 10 : 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if !others.isEmpty {
                // 다른 선수들은 한 Text 로 이어 붙여, 좁으면 통째로 줄이고(최대 70%)
                // 그래도 넘치면 끝을 자른다. 우선순위를 낮춰 주인공보다 먼저 양보한다.
                othersText
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .truncationMode(.tail)
                    .layoutPriority(-1)
            }
        }
    }

    // '· 이재성 교체 출전 · 홍현석 ⚽1' — 이름은 주인공처럼 옐로 볼드, 골·도움은 배지 글자로.
    private var othersText: Text {
        let small = Font.system(size: compact ? 10 : 12)
        let badge = Font.system(size: compact ? 10 : 12, weight: .heavy)
        var t = Text("")
        for (i, p) in others.enumerated() {
            t = t + Text(i == 0 ? "· " : "  · ").font(small).foregroundColor(.secondary)
            t = t + Text(p.name).font(.system(size: compact ? 11 : 13, weight: .bold)).foregroundColor(acc)
            if p.goals > 0 || p.assists > 0 {
                if p.goals > 0 { t = t + Text(" ⚽\(p.goals)").font(badge).foregroundColor(acc) }
                if p.assists > 0 { t = t + Text(" 🅰️\(p.assists)").font(badge).foregroundColor(acc) }
            } else if showLine && !p.line.isEmpty {
                t = t + Text(" \(p.line)").font(small).foregroundColor(.secondary)
            }
        }
        return t
    }
}

// 팀 배지 — 앱이 App Group 에 미리 캐시해둔 엠블럼을 디스크에서 읽는다.
// 위젯은 네트워크를 쓸 수 없으므로(뷰가 동기 렌더) 여기서 받아올 방법은 없다.
// 아직 캐시가 없거나 다운로드가 실패했으면 팀 약칭 배지로 대체한다.
private struct TeamBadge: View {
    let abbr: String
    let logoFile: String
    var size: CGFloat = 30

    var body: some View {
        if let path = JumoLogoStore.localPath(logoFile),
           let img = UIImage(contentsOfFile: path) {
            Image(uiImage: img)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
        } else {
            // 다이나믹 아일랜드처럼 작을 땐 3글자를 넣으면 읽을 수 없다.
            Text(abbr.isEmpty ? "?" : String(abbr.prefix(size < 22 ? 2 : 3)).uppercased())
                .font(.system(size: size * (size < 22 ? 0.5 : 0.37), weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(Circle().fill(Color.white.opacity(0.14)))
                .overlay(Circle().stroke(Color.white.opacity(0.22), lineWidth: 0.5))
        }
    }
}

// 잠금화면 / 배너
private struct LockScreenView: View {
    let ctx: ActivityViewContext<JumoMatchAttributes>

    var body: some View {
        let mp = MatchPlayers(ctx)
        VStack(spacing: 12) {
            // 윗줄: 대회 · 우리 선수 기록 ······ 진행 시간
            HStack(spacing: 8) {
                // 더비라 선수가 둘 이상 서면 이름이 잘리지 않게 대회명을 뺀다(한 줄 유지).
                if mp.others.isEmpty {
                    Text(ctx.attributes.competition)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1).truncationMode(.tail)
                        .layoutPriority(0)   // 대회명이 길면 이쪽이 먼저 줄어든다
                }
                PlayerLine(name: ctx.attributes.playerName,
                           number: ctx.attributes.playerNumber,
                           line: mp.main.line,
                           goals: mp.main.goals,
                           assists: mp.main.assists,
                           others: mp.others,
                           showLine: ctx.state.status != "final",
                           compact: true)
                    .layoutPriority(2)
                Spacer(minLength: 4)
                // 진행 시간은 절대 줄이지 않는다 — 선수 줄이 길면 그쪽이 줄어든다.
                StatusPill(status: ctx.state.status, minute: ctx.state.minute)
                    .fixedSize()
            }

            // 가운뎃줄: 팀명 [배지]   점수 : 점수   [배지] 팀명 — 엠블럼을 점수 옆에 붙여 좌우 대칭으로 가운데 정렬
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    Text(ctx.attributes.homeName)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1).minimumScaleFactor(0.8)
                    TeamBadge(abbr: ctx.attributes.homeAbbr, logoFile: ctx.attributes.homeLogoFile)
                }
                .frame(maxWidth: .infinity, alignment: .trailing)

                // 점수가 카드에서 너무 커 보인다는 제보로 80% 로 줄였다(28→22).
                // 가운데 콜론도 같은 비율로 줄여 균형을 유지한다(18→14).
                HStack(spacing: 6) {
                    Text("\(ctx.state.homeScore)")
                        .font(.system(size: 22, weight: .heavy, design: .rounded))
                    Text(":")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                    Text("\(ctx.state.awayScore)")
                        .font(.system(size: 22, weight: .heavy, design: .rounded))
                }
                .fixedSize()

                HStack(spacing: 8) {
                    TeamBadge(abbr: ctx.attributes.awayAbbr, logoFile: ctx.attributes.awayLogoFile)
                    Text(ctx.attributes.awayName)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1).minimumScaleFactor(0.8)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 13)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(acc)
    }
}

// 진행 상태 배지 — 라이브면 옐로, 하프타임·종료는 차분하게
private struct StatusPill: View {
    let status: String
    let minute: String
    var body: some View {
        let live = status == "live"
        return HStack(spacing: 4) {
            if live {
                // 진행 중이라는 신호 — 점이 깜빡이면 정지된 스코어와 확실히 구분된다.
                Circle().fill(acc).frame(width: 5, height: 5)
                    .background(Circle().fill(acc.opacity(0.3)).frame(width: 11, height: 11))
            }
            Text(minute)
                .font(.system(size: 10, weight: .heavy))
                .foregroundStyle(live ? acc : .secondary)
        }
        .padding(.horizontal, 7).padding(.vertical, 3)
        .background(Capsule().fill(live ? acc.opacity(0.16) : Color.white.opacity(0.10)))
    }
}

@main
struct JumoLiveActivityBundle: WidgetBundle {
    var body: some Widget { JumoMatchActivity() }
}

struct JumoMatchActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: JumoMatchAttributes.self) { ctx in
            LockScreenView(ctx: ctx)
        } dynamicIsland: { ctx in
            DynamicIsland {
                // 확장 — 길게 눌렀을 때
                DynamicIslandExpandedRegion(.leading) {
                    VStack(spacing: 2) {
                        TeamBadge(abbr: ctx.attributes.homeAbbr,
                                  logoFile: ctx.attributes.homeLogoFile, size: 24)
                        Text("\(ctx.state.homeScore)")
                            .font(.system(size: 19, weight: .heavy, design: .rounded))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(spacing: 2) {
                        TeamBadge(abbr: ctx.attributes.awayAbbr,
                                  logoFile: ctx.attributes.awayLogoFile, size: 24)
                        Text("\(ctx.state.awayScore)")
                            .font(.system(size: 19, weight: .heavy, design: .rounded))
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    StatusPill(status: ctx.state.status, minute: ctx.state.minute)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    let mp = MatchPlayers(ctx)
                    PlayerLine(name: ctx.attributes.playerName,
                               number: ctx.attributes.playerNumber,
                               line: mp.main.line,
                               goals: mp.main.goals,
                               assists: mp.main.assists,
                               others: mp.others,
                               showLine: ctx.state.status != "final")
                }
            } compactLeading: {
                // 점수만 있으면 어느 경기인지 알 수가 없다 — 엠블럼을 양쪽에 붙여
                // 노치를 사이에 두고 '홈 0 : 0 원정' 으로 읽히게 한다.
                HStack(spacing: 3) {
                    TeamBadge(abbr: ctx.attributes.homeAbbr,
                              logoFile: ctx.attributes.homeLogoFile, size: 17)
                    Text("\(ctx.state.homeScore)")
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                }
            } compactTrailing: {
                HStack(spacing: 3) {
                    Text("\(ctx.state.awayScore)")
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                    TeamBadge(abbr: ctx.attributes.awayAbbr,
                              logoFile: ctx.attributes.awayLogoFile, size: 17)
                }
            } minimal: {
                // 최소 표시는 원 하나 크기다. 우리 선수(이 카드의 주인공)가 득점했으면
                // 그게 최우선, 아니면 점수를 붙여 쓴다.
                let mainGoals = MatchPlayers(ctx).main.goals
                if mainGoals > 0 {
                    Text("⚽\(mainGoals)")
                        .font(.system(size: 11, weight: .heavy))
                } else {
                    Text("\(ctx.state.homeScore):\(ctx.state.awayScore)")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                }
            }
            .keylineTint(acc)
        }
    }
}
