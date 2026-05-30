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
    @State private var dragX: CGFloat? = nil
    @State private var pressed = false
    private let accent = Color(red: 0.961, green: 0.769, blue: 0.0)   // #f5c400 — glyph only
    private let barHeight: CGFloat = 56

    var body: some View {
        GeometryReader { geo in
            let n = max(1, model.tabs.count)
            let cellW = geo.size.width / CGFloat(n)
            let selW = cellW - 6
            let half = selW / 2
            let rest = cellW * (CGFloat(model.selected) + 0.5)
            let center = min(max(dragX ?? rest, half + 4), geo.size.width - half - 4)
            ZStack {
                // ── Glass: native frosted bar + clear selection window that
                //    refracts the content behind and morphs as it moves ───────
                GlassEffectContainer(spacing: 26) {
                    ZStack(alignment: .leading) {
                        Capsule(style: .continuous).fill(Color.clear)
                            .glassEffect(.regular, in: .capsule)
                            .frame(width: geo.size.width, height: geo.size.height)
                        Capsule(style: .continuous).fill(Color.clear)
                            .glassEffect(.clear.interactive(), in: .capsule)
                            .glassEffectID("sel", in: ns)
                            .frame(width: selW + (pressed ? 18 : 0), height: geo.size.height - (pressed ? 2 : 10))
                            .position(x: center, y: geo.size.height / 2)
                    }
                }

                // ── Bright icons + labels on top ─────────────────────────────
                HStack(spacing: 0) {
                    ForEach(Array(model.tabs.enumerated()), id: \.element.id) { idx, tab in
                        VStack(spacing: 3) {
                            Image(systemName: tab.symbol).font(.system(size: 19, weight: .semibold))
                            Text(tab.label).font(.system(size: 10, weight: .semibold))
                        }
                        .foregroundStyle(idx == model.selected ? accent : Color.white.opacity(0.92))
                        .frame(maxWidth: .infinity)
                    }
                }
                .allowsHitTesting(false)

                // ── Gesture overlay (reliable tap + drag across the whole bar) ─
                Color.clear.contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { v in
                                if !pressed { withAnimation(.spring(response: 0.28, dampingFraction: 0.6)) { pressed = true } }
                                let moved = abs(v.translation.width) + abs(v.translation.height)
                                if moved > 6 { dragX = min(max(v.location.x, half + 4), geo.size.width - half - 4) }
                                let i = clamp(Int(v.location.x / cellW), n)
                                if i != model.selected {
                                    withAnimation(.spring(response: 0.3, dampingFraction: 0.74)) { model.selected = i }
                                }
                            }
                            .onEnded { v in
                                let i = clamp(Int(v.location.x / cellW), n)
                                withAnimation(.spring(response: 0.34, dampingFraction: 0.72)) {
                                    dragX = nil
                                    pressed = false
                                    model.selected = i
                                }
                                model.onSelect?(i)
                            }
                    )
            }
        }
        .frame(height: barHeight)
    }

    private func clamp(_ i: Int, _ n: Int) -> Int { max(0, min(n - 1, i)) }
}

class MainViewController: CAPBridgeViewController, WKScriptMessageHandler, UIGestureRecognizerDelegate {

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
        setupTopGestures()
    }

    // MARK: - Status-bar tap → scroll to top, left-edge swipe → back

    private func setupTopGestures() {
        // Inner web divs are the real scrollers, so the webview's own scrollView
        // must not swallow the status-bar tap — we detect it ourselves.
        wk?.scrollView.scrollsToTop = false

        let topTap = UITapGestureRecognizer(target: self, action: #selector(handleTopTap(_:)))
        topTap.cancelsTouchesInView = false
        topTap.delegate = self
        view.addGestureRecognizer(topTap)

        let edge = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(handleEdgeBack(_:)))
        edge.edges = .left
        edge.delegate = self
        view.addGestureRecognizer(edge)
    }

    @objc private func handleTopTap(_ g: UITapGestureRecognizer) {
        if g.location(in: view).y <= max(view.safeAreaInsets.top, 28) {
            wk?.evaluateJavaScript("window.__scrollTop && window.__scrollTop()")
        }
    }

    @objc private func handleEdgeBack(_ g: UIScreenEdgePanGestureRecognizer) {
        if g.state == .ended, g.translation(in: view).x > 40 {
            wk?.evaluateJavaScript("window.__back && window.__back()")
        }
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

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
