import SwiftUI
import WidgetKit
import ActivityKit

// 브랜드 옐로 — 앱의 --acc 와 같은 값.
private let acc = Color(red: 0.961, green: 0.769, blue: 0.0)

// 우리 선수 기록 한 줄. 골·도움이 있으면 강조하고, 없으면 출전 상태만 담담히.
private struct PlayerLine: View {
    let name: String
    let number: Int
    let line: String
    let goals: Int
    let assists: Int
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
            } else if !line.isEmpty {
                Text(line)
                    .font(.system(size: compact ? 10 : 12))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

// 팀 배지 — 위젯은 원격 이미지를 못 불러온다(AsyncImage 미지원, 콘텐츠 상태에
// 이미지도 못 싣는다). 그래서 실제 엠블럼 대신 팀 약칭을 원형 배지로 그린다.
private struct TeamBadge: View {
    let abbr: String
    var body: some View {
        Text(abbr.isEmpty ? "?" : String(abbr.prefix(3)).uppercased())
            .font(.system(size: 11, weight: .heavy, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(Circle().fill(Color.white.opacity(0.14)))
            .overlay(Circle().stroke(Color.white.opacity(0.22), lineWidth: 0.5))
    }
}

// 잠금화면 / 배너
private struct LockScreenView: View {
    let ctx: ActivityViewContext<JumoMatchAttributes>

    var body: some View {
        VStack(spacing: 12) {
            // 윗줄: 대회 · 우리 선수 기록 ······ 진행 시간
            HStack(spacing: 8) {
                Text(ctx.attributes.competition)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1).truncationMode(.tail)
                    .layoutPriority(0)   // 대회명이 길면 이쪽이 먼저 줄어든다
                PlayerLine(name: ctx.attributes.playerName,
                           number: ctx.attributes.playerNumber,
                           line: ctx.state.playerLine,
                           goals: ctx.state.playerGoals,
                           assists: ctx.state.playerAssists,
                           compact: true)
                    .layoutPriority(2)
                Spacer(minLength: 4)
                StatusPill(status: ctx.state.status, minute: ctx.state.minute)
            }

            // 가운뎃줄: [배지] 팀명   점수 : 점수   팀명 [배지] — 좌우 대칭으로 가운데 정렬
            HStack(spacing: 10) {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    TeamBadge(abbr: ctx.attributes.homeAbbr)
                    Text(ctx.attributes.homeName)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1).minimumScaleFactor(0.8)
                }
                .frame(maxWidth: .infinity, alignment: .trailing)

                HStack(spacing: 6) {
                    Text("\(ctx.state.homeScore)")
                        .font(.system(size: 28, weight: .heavy, design: .rounded))
                    Text(":")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(.secondary)
                    Text("\(ctx.state.awayScore)")
                        .font(.system(size: 28, weight: .heavy, design: .rounded))
                }
                .fixedSize()

                HStack(spacing: 8) {
                    Text(ctx.attributes.awayName)
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1).minimumScaleFactor(0.8)
                    TeamBadge(abbr: ctx.attributes.awayAbbr)
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
                        Text(ctx.attributes.homeAbbr)
                            .font(.system(size: 12, weight: .semibold)).lineLimit(1)
                        Text("\(ctx.state.homeScore)")
                            .font(.system(size: 24, weight: .heavy, design: .rounded))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(spacing: 2) {
                        Text(ctx.attributes.awayAbbr)
                            .font(.system(size: 12, weight: .semibold)).lineLimit(1)
                        Text("\(ctx.state.awayScore)")
                            .font(.system(size: 24, weight: .heavy, design: .rounded))
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    StatusPill(status: ctx.state.status, minute: ctx.state.minute)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    PlayerLine(name: ctx.attributes.playerName,
                               number: ctx.attributes.playerNumber,
                               line: ctx.state.playerLine,
                               goals: ctx.state.playerGoals,
                               assists: ctx.state.playerAssists)
                }
            } compactLeading: {
                // 컴팩트 — 폭이 매우 좁다. 점수만.
                Text("\(ctx.state.homeScore):\(ctx.state.awayScore)")
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .foregroundStyle(acc)
            } compactTrailing: {
                // 우리 선수가 득점하면 그것만큼 중요한 정보가 없다.
                if ctx.state.playerGoals > 0 {
                    Text("⚽\(ctx.state.playerGoals)").font(.system(size: 12, weight: .heavy))
                } else {
                    Text(ctx.state.minute).font(.system(size: 11, weight: .semibold))
                }
            } minimal: {
                Text("\(ctx.state.homeScore):\(ctx.state.awayScore)")
                    .font(.system(size: 11, weight: .heavy, design: .rounded))
                    .foregroundStyle(acc)
            }
            .keylineTint(acc)
        }
    }
}
