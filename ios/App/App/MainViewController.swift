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
                // Frosted bar + clear selection pill (morphs via glassEffectID,
                // grows while pressed for a liquid expand).
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

                // Crisp glyphs on top.
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

                // One reliable gesture surface for tap + drag across the whole bar.
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
    private var bellHost: UIView?
    private var bellBadge: UILabel?
    private var backHost: UIView?
    private var followHost: UIView?
    private var followLabel: UILabel?
    private var followIcon: UIImageView?
    private var actionHost: UIView?
    private var actionLabel: UILabel?
    private var actionIcon: UIImageView?
    private var didSetup = false
    private var wk: WKWebView? { self.webView as? WKWebView }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didSetup else { return }
        didSetup = true
        if #available(iOS 26.0, *) {
            wk?.configuration.userContentController.add(self, name: "tabbar")
            wk?.configuration.userContentController.add(self, name: "bell")
            wk?.configuration.userContentController.add(self, name: "detailbar")
            setupTabBar()
            setupNotifBell()
            setupDetailChrome()
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
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            wk?.evaluateJavaScript("window.__back && window.__back()")
        }
    }

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    // MARK: - Native Liquid Glass notification bell (top-right, home only)

    @available(iOS 26.0, *)
    private func setupNotifBell() {
        let size: CGFloat = 38

        let e = UIGlassEffect(style: .regular)
        e.isInteractive = true
        let glass = UIVisualEffectView(effect: e)
        glass.translatesAutoresizingMaskIntoConstraints = false
        glass.layer.cornerRadius = size / 2
        glass.layer.cornerCurve = .continuous
        glass.clipsToBounds = true

        let icon = UIImageView(image: UIImage(systemName: "bell.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)))
        icon.tintColor = UIColor.white.withAlphaComponent(0.92)
        icon.contentMode = .center
        icon.translatesAutoresizingMaskIntoConstraints = false
        glass.contentView.addSubview(icon)
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: glass.contentView.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: glass.contentView.centerYAnchor)
        ])

        // Container lets the unread badge overflow the circular glass.
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(glass)
        NSLayoutConstraint.activate([
            glass.topAnchor.constraint(equalTo: container.topAnchor),
            glass.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            glass.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            glass.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])

        let badge = UILabel()
        badge.translatesAutoresizingMaskIntoConstraints = false
        badge.backgroundColor = UIColor(red: 0.9, green: 0.19, blue: 0.19, alpha: 1)
        badge.textColor = .white
        badge.font = .systemFont(ofSize: 10, weight: .bold)
        badge.textAlignment = .center
        badge.layer.cornerRadius = 8
        badge.layer.borderWidth = 1.5
        badge.layer.borderColor = UIColor.black.withAlphaComponent(0.4).cgColor
        badge.clipsToBounds = true
        badge.isHidden = true
        container.addSubview(badge)
        NSLayoutConstraint.activate([
            badge.topAnchor.constraint(equalTo: container.topAnchor, constant: -4),
            badge.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: 4),
            badge.heightAnchor.constraint(equalToConstant: 16),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 16)
        ])
        bellBadge = badge

        view.addSubview(container)
        NSLayoutConstraint.activate([
            container.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            container.widthAnchor.constraint(equalToConstant: size),
            container.heightAnchor.constraint(equalToConstant: size)
        ])
        container.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(bellTapped)))
        container.alpha = 0   // shown only when the web says we're on the home screen
        bellHost = container
    }

    @objc private func bellTapped() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        wk?.evaluateJavaScript("window.__jumoNotif && window.__jumoNotif()")
    }

    private func updateBell(show: Bool, unread: Int) {
        UIView.animate(withDuration: 0.25) { self.bellHost?.alpha = show ? 1 : 0 }
        if unread > 0 {
            bellBadge?.text = unread > 99 ? "99+" : "\(unread)"
            bellBadge?.isHidden = false
        } else {
            bellBadge?.isHidden = true
        }
    }

    // MARK: - Detail-screen toolbar (glass back + follow), shown on 2-depth screens

    @available(iOS 26.0, *)
    private func glassCircle(symbol: String, size: CGFloat) -> UIVisualEffectView {
        let e = UIGlassEffect(style: .regular); e.isInteractive = true
        let g = UIVisualEffectView(effect: e)
        g.translatesAutoresizingMaskIntoConstraints = false
        g.layer.cornerRadius = size / 2; g.layer.cornerCurve = .continuous; g.clipsToBounds = true
        let icon = UIImageView(image: UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)))
        icon.tintColor = UIColor.white.withAlphaComponent(0.92); icon.contentMode = .center
        icon.translatesAutoresizingMaskIntoConstraints = false
        g.contentView.addSubview(icon)
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: g.contentView.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: g.contentView.centerYAnchor)
        ])
        return g
    }

    @available(iOS 26.0, *)
    private func setupDetailChrome() {
        let bsize: CGFloat = 38
        let back = glassCircle(symbol: "chevron.left", size: bsize)
        back.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(backChromeTapped)))
        view.addSubview(back)
        NSLayoutConstraint.activate([
            back.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            back.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            back.widthAnchor.constraint(equalToConstant: bsize),
            back.heightAnchor.constraint(equalToConstant: bsize)
        ])
        back.alpha = 0
        backHost = back

        let fe = UIGlassEffect(style: .clear); fe.isInteractive = true
        let pill = UIVisualEffectView(effect: fe)
        pill.translatesAutoresizingMaskIntoConstraints = false
        pill.layer.cornerRadius = 16; pill.layer.cornerCurve = .continuous; pill.clipsToBounds = true
        let icon = UIImageView(); icon.contentMode = .center
        icon.translatesAutoresizingMaskIntoConstraints = false
        let label = UILabel(); label.font = .systemFont(ofSize: 13, weight: .bold)
        label.translatesAutoresizingMaskIntoConstraints = false
        let row = UIStackView(arrangedSubviews: [icon, label])
        row.axis = .horizontal; row.spacing = 5; row.alignment = .center
        row.translatesAutoresizingMaskIntoConstraints = false
        pill.contentView.addSubview(row)
        NSLayoutConstraint.activate([
            row.centerYAnchor.constraint(equalTo: pill.contentView.centerYAnchor),
            row.leadingAnchor.constraint(equalTo: pill.contentView.leadingAnchor, constant: 13),
            row.trailingAnchor.constraint(equalTo: pill.contentView.trailingAnchor, constant: -13)
        ])
        pill.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(followTapped)))
        view.addSubview(pill)
        NSLayoutConstraint.activate([
            pill.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 13),
            pill.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            pill.heightAnchor.constraint(equalToConstant: 32)
        ])
        pill.alpha = 0
        followHost = pill; followLabel = label; followIcon = icon

        // Top-right action pill: '선수 편집' (선수 탭) / '완료' (선수 편집 화면).
        // Same slot as the follow pill — only one is ever visible per screen.
        let ae = UIGlassEffect(style: .clear); ae.isInteractive = true
        let apill = UIVisualEffectView(effect: ae)
        apill.translatesAutoresizingMaskIntoConstraints = false
        apill.layer.cornerRadius = 16; apill.layer.cornerCurve = .continuous; apill.clipsToBounds = true
        let aicon = UIImageView(); aicon.contentMode = .center
        aicon.translatesAutoresizingMaskIntoConstraints = false
        let alabel = UILabel(); alabel.font = .systemFont(ofSize: 13, weight: .bold)
        alabel.translatesAutoresizingMaskIntoConstraints = false
        let arow = UIStackView(arrangedSubviews: [aicon, alabel])
        arow.axis = .horizontal; arow.spacing = 5; arow.alignment = .center
        arow.translatesAutoresizingMaskIntoConstraints = false
        apill.contentView.addSubview(arow)
        NSLayoutConstraint.activate([
            arow.centerYAnchor.constraint(equalTo: apill.contentView.centerYAnchor),
            arow.leadingAnchor.constraint(equalTo: apill.contentView.leadingAnchor, constant: 13),
            arow.trailingAnchor.constraint(equalTo: apill.contentView.trailingAnchor, constant: -13)
        ])
        apill.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(actionTapped)))
        view.addSubview(apill)
        NSLayoutConstraint.activate([
            apill.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 13),
            apill.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            apill.heightAnchor.constraint(equalToConstant: 32)
        ])
        apill.alpha = 0
        actionHost = apill; actionLabel = alabel; actionIcon = aicon
    }

    @objc private func backChromeTapped() { UIImpactFeedbackGenerator(style: .light).impactOccurred(); wk?.evaluateJavaScript("window.__back && window.__back()") }
    @objc private func followTapped() { UIImpactFeedbackGenerator(style: .light).impactOccurred(); wk?.evaluateJavaScript("window.__jumoFollow && window.__jumoFollow()") }
    @objc private func actionTapped() { UIImpactFeedbackGenerator(style: .light).impactOccurred(); wk?.evaluateJavaScript("window.__jumoTopAction && window.__jumoTopAction()") }

    private func updateDetailChrome(back: Bool, followShow: Bool, followOn: Bool,
                                    actionShow: Bool, actionLabel: String, actionIcon: String) {
        UIView.animate(withDuration: 0.2) {
            self.backHost?.alpha = back ? 1 : 0
            self.followHost?.alpha = followShow ? 1 : 0
            self.actionHost?.alpha = actionShow ? 1 : 0
        }
        let acc = UIColor(red: 0.961, green: 0.769, blue: 0.0, alpha: 1)
        let cfg = UIImage.SymbolConfiguration(pointSize: 11, weight: .bold)
        if followOn {
            followIcon?.image = UIImage(systemName: "checkmark", withConfiguration: cfg)
            followIcon?.tintColor = acc
            followLabel?.text = "팔로우 중"; followLabel?.textColor = acc
        } else {
            followIcon?.image = UIImage(systemName: "plus", withConfiguration: cfg)
            followIcon?.tintColor = .white
            followLabel?.text = "팔로우"; followLabel?.textColor = .white
        }
        if actionShow {
            self.actionLabel?.text = actionLabel; self.actionLabel?.textColor = acc
            if actionIcon.isEmpty {
                self.actionIcon?.isHidden = true; self.actionIcon?.image = nil
            } else {
                self.actionIcon?.isHidden = false
                self.actionIcon?.image = UIImage(systemName: actionIcon, withConfiguration: cfg)
                self.actionIcon?.tintColor = acc
            }
        }
    }

    @available(iOS 26.0, *)
    private func setupTabBar() {
        model.onSelect = { [weak self] i in
            guard let self = self else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()   // GNB 탭 햅틱
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
        } else if message.name == "bell", let d = message.body as? [String: Any] {
            updateBell(show: (d["show"] as? Bool) ?? false, unread: (d["unread"] as? Int) ?? 0)
        } else if message.name == "detailbar", let d = message.body as? [String: Any] {
            let action = d["action"] as? [String: Any]
            updateDetailChrome(back: (d["back"] as? Bool) ?? false,
                               followShow: (d["followShow"] as? Bool) ?? false,
                               followOn: (d["followOn"] as? Bool) ?? false,
                               actionShow: (action?["show"] as? Bool) ?? false,
                               actionLabel: (action?["label"] as? String) ?? "",
                               actionIcon: (action?["icon"] as? String) ?? "")
        }
    }
}
