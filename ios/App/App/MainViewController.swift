import UIKit
import WebKit
import Capacitor
import SwiftUI

// Native iOS 26 Liquid Glass tab bar (SwiftUI), overlaid on the Capacitor
// WKWebView. Built entirely from Apple's Liquid Glass primitives —
// GlassEffectContainer + .glassEffect() + glassEffectID morphing — with NO
// custom chrome (no borders, no tinted fills). The selection capsule samples
// the web content behind it (the container lets glass refract content rather
// than other glass) and morphs fluidly as it moves between tabs. Only the
// selected icon + label are tinted brand yellow.

struct JumoTab: Identifiable { let id: String; let label: String; let symbol: String }

final class TabBarModel: ObservableObject {
    @Published var selected: Int = 0
    let tabs: [JumoTab]
    var onSelect: ((Int) -> Void)?
    init(tabs: [JumoTab]) { self.tabs = tabs }
}

@available(iOS 26.0, *)
struct GlassTabBar: View {
    @ObservedObject var model: TabBarModel
    @Namespace private var ns
    private let accent = Color(red: 0.961, green: 0.769, blue: 0.0)   // #f5c400 — glyph only
    private let barHeight: CGFloat = 56

    var body: some View {
        GeometryReader { geo in
            let n = max(1, model.tabs.count)
            let cellW = geo.size.width / CGFloat(n)
            GlassEffectContainer(spacing: 28) {
                HStack(spacing: 0) {
                    ForEach(Array(model.tabs.enumerated()), id: \.element.id) { idx, tab in
                        cell(idx, tab)
                    }
                }
                .background {
                    Color.clear.glassEffect(.clear, in: .capsule)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { v in
                        let i = clamp(Int(v.location.x / cellW), n)
                        if i != model.selected {
                            withAnimation(.spring(response: 0.38, dampingFraction: 0.72)) { model.selected = i }
                        }
                    }
                    .onEnded { v in
                        let i = clamp(Int(v.location.x / cellW), n)
                        withAnimation(.spring(response: 0.38, dampingFraction: 0.72)) { model.selected = i }
                        model.onSelect?(i)
                    }
            )
        }
        .frame(height: barHeight)
    }

    private func clamp(_ i: Int, _ n: Int) -> Int { max(0, min(n - 1, i)) }

    @ViewBuilder private func cell(_ idx: Int, _ tab: JumoTab) -> some View {
        let on = idx == model.selected
        VStack(spacing: 3) {
            Image(systemName: tab.symbol).font(.system(size: 18, weight: .semibold))
            Text(tab.label).font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(on ? accent : Color.white.opacity(0.6))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            if on {
                Color.clear
                    .padding(.vertical, 7)
                    .padding(.horizontal, 5)
                    .glassEffect(.clear.interactive(), in: .capsule)
                    .glassEffectID("sel", in: ns)
            }
        }
    }
}

class MainViewController: CAPBridgeViewController, WKScriptMessageHandler {

    private let tabs: [JumoTab] = [
        JumoTab(id: "home",     label: "홈",     symbol: "house.fill"),
        JumoTab(id: "schedule", label: "일정",   symbol: "calendar"),
        JumoTab(id: "players",  label: "선수",   symbol: "person.fill"),
        JumoTab(id: "news",     label: "뉴스",   symbol: "newspaper.fill"),
        JumoTab(id: "more",     label: "더보기", symbol: "ellipsis")
    ]
    private lazy var model = TabBarModel(tabs: tabs)
    private var hostView: UIView?
    private var didSetup = false
    private var wk: WKWebView? { self.webView as? WKWebView }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didSetup else { return }
        didSetup = true
        if #available(iOS 26.0, *) {
            wk?.configuration.userContentController.add(self, name: "tabbar")
            setupTabBar()
            enableWebNativeTabBar()
        }
        // iOS < 26: keep the web app's own CSS tab bar.
    }

    @available(iOS 26.0, *)
    private func setupTabBar() {
        model.onSelect = { [weak self] i in
            guard let self = self else { return }
            self.wk?.evaluateJavaScript("window.__nativeTab && window.__nativeTab('\(self.tabs[i].id)')")
        }
        let hc = UIHostingController(rootView: GlassTabBar(model: model))
        hc.view.backgroundColor = .clear
        hc.view.translatesAutoresizingMaskIntoConstraints = false
        addChild(hc)
        view.addSubview(hc.view)
        NSLayoutConstraint.activate([
            hc.view.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            hc.view.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            hc.view.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -4),
            hc.view.heightAnchor.constraint(equalToConstant: 56)
        ])
        hc.didMove(toParent: self)
        hostView = hc.view

        // Stay hidden beneath the launch splash, then fade in with the app.
        hc.view.alpha = 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.9) {
            UIView.animate(withDuration: 0.45, delay: 0, options: [.curveEaseOut]) { hc.view.alpha = 1 }
        }
    }

    private func enableWebNativeTabBar() {
        var attempts = 0
        func tryEnable() {
            wk?.evaluateJavaScript("(window.__enableNativeTabBar?(window.__enableNativeTabBar(),true):false)") { result, _ in
                if (result as? Bool) != true && attempts < 40 {
                    attempts += 1
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { tryEnable() }
                }
            }
        }
        tryEnable()
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "tabbar", let id = message.body as? String,
           let i = tabs.firstIndex(where: { $0.id == id }), i != model.selected {
            withAnimation(.spring(response: 0.38, dampingFraction: 0.72)) { model.selected = i }
        }
    }
}
