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

// 잠금화면 / 배너
private struct LockScreenView: View {
    let ctx: ActivityViewContext<JumoMatchAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(ctx.attributes.competition)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                StatusPill(status: ctx.state.status, minute: ctx.state.minute)
            }

            HStack(alignment: .center, spacing: 12) {
                Text(ctx.attributes.homeName)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text("\(ctx.state.homeScore)")
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                Text(":").font(.system(size: 20, weight: .medium)).foregroundStyle(.secondary)
                Text("\(ctx.state.awayScore)")
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                Spacer(minLength: 8)
                Text(ctx.attributes.awayName)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                    .multilineTextAlignment(.trailing)
            }

            PlayerLine(name: ctx.attributes.playerName,
                       number: ctx.attributes.playerNumber,
                       line: ctx.state.playerLine,
                       goals: ctx.state.playerGoals,
                       assists: ctx.state.playerAssists)
        }
        .padding(14)
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
                Circle().fill(acc).frame(width: 5, height: 5)
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
