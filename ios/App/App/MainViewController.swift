import UIKit
import WebKit
import Capacitor
import SafariServices

// Native iOS 26 Liquid Glass tab bar, overlaid on the Capacitor WKWebView.
// Uses a REAL UITabBarController so the system draws its own floating Liquid
// Glass bar — geometry, typography, selection morph, scroll-edge treatment,
// Reduce Transparency and Dynamic Type all handled by UIKit, zero custom
// chrome. The controller's content area is transparent and a passthrough
// wrapper forwards every touch outside the bar itself to the webview below.

struct JumoTab: Identifiable { let id: String; let label: String; let symbol: String }

// Full-screen overlay that only intercepts touches landing on the system tab
// bar; everything else falls through to the webview underneath.
private final class TabBarPassthroughView: UIView {
    weak var passthroughTarget: UIView?
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let v = super.hitTest(point, with: event), let bar = passthroughTarget else { return nil }
        return v.isDescendant(of: bar) ? v : nil
    }
}

class MainViewController: CAPBridgeViewController, WKScriptMessageHandler, UIGestureRecognizerDelegate, UITabBarControllerDelegate {

    private let tabs: [JumoTab] = [
        // 웹 탭바와 같은 얇은 아웃라인 아이콘 — filled 변형은 시각적으로 무겁다.
        JumoTab(id: "home",     label: "홈",     symbol: "house"),
        JumoTab(id: "schedule", label: "일정",   symbol: "calendar"),
        JumoTab(id: "players",  label: "선수",   symbol: "person"),
        JumoTab(id: "news",     label: "뉴스",   symbol: "newspaper"),
        JumoTab(id: "more",     label: "더보기", symbol: "ellipsis")
    ]
    private var tabBarVC: UITabBarController?
    private var hostView: UIView?
    private var bellHost: UIView?
    private var bellBadge: UILabel?
    private var backHost: UIView?
    private var followHost: UIView?
    private var muteHost: UIVisualEffectView?
    private var pendingMute: (Bool, Bool)?
    private var muteIcon: UIImageView?
    private var followLabel: UILabel?
    private var followIcon: UIImageView?
    private var actionHost: UIView?
    private var actionLabel: UILabel?
    private var actionIcon: UIImageView?
    private var didSetup = false
    private var wk: WKWebView? { self.webView as? WKWebView }

    // 스플래시가 걷히기 전에는 네이티브 크롬(벨·상세 툴바)을 띄우지 않는다.
    // 웹은 마운트 직후 "홈이다/상세다"를 알려오는데, 그 시점엔 아직 스플래시가
    // 보이는 중이라 버튼만 먼저 떠 보이는 문제가 있었다. 준비되기 전 상태는
    // 보류해 두고 전환이 끝난 뒤 한 번에 반영한다.
    private var chromeReady = false
    private var pendingBell: (show: Bool, unread: Int)?
    private var pendingDetail: (back: Bool, followShow: Bool, followOn: Bool,
                               actionShow: Bool, actionLabel: String, actionIcon: String)?

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didSetup else { return }
        didSetup = true
        if #available(iOS 26.0, *) {
            wk?.configuration.userContentController.add(self, name: "tabbar")
            wk?.configuration.userContentController.add(self, name: "bell")
            wk?.configuration.userContentController.add(self, name: "detailbar")
            wk?.configuration.userContentController.add(self, name: "openurl")
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
        guard chromeReady else { pendingBell = (show, unread); return }
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

        // 선수별 알림 on/off — 팔로우 알약 왼쪽에 글래스 원형으로. 웹 버튼과 자리가
        // 겹치지 않게 네이티브에서 그린다(웹 쪽은 __nativeChrome 일 때 숨김).
        let msize: CGFloat = 34
        let mute = glassCircle(symbol: "bell.fill", size: msize)
        mute.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(muteTapped)))
        view.addSubview(mute)
        NSLayoutConstraint.activate([
            mute.centerYAnchor.constraint(equalTo: pill.centerYAnchor),
            mute.trailingAnchor.constraint(equalTo: pill.leadingAnchor, constant: -8),
            mute.widthAnchor.constraint(equalToConstant: msize),
            mute.heightAnchor.constraint(equalToConstant: msize)
        ])
        mute.alpha = 0
        muteHost = mute
        muteIcon = mute.contentView.subviews.compactMap { $0 as? UIImageView }.first

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
    @objc private func muteTapped() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        wk?.evaluateJavaScript("window.__jumoMuteToggle && window.__jumoMuteToggle()")
    }

    @objc private func followTapped() { UIImpactFeedbackGenerator(style: .light).impactOccurred(); wk?.evaluateJavaScript("window.__jumoFollow && window.__jumoFollow()") }
    @objc private func actionTapped() { UIImpactFeedbackGenerator(style: .light).impactOccurred(); wk?.evaluateJavaScript("window.__jumoTopAction && window.__jumoTopAction()") }

    private func updateDetailChrome(back: Bool, followShow: Bool, followOn: Bool,
                                    actionShow: Bool, actionLabel: String, actionIcon: String,
                                    muteShow: Bool = false, muteOn: Bool = false) {
        guard chromeReady else {
            // 알림 탭으로 상세 화면부터 시작하는 경우에도 스플래시 위에 뒤로가기/팔로우가
            // 먼저 뜨지 않도록 보류한다.
            pendingDetail = (back, followShow, followOn, actionShow, actionLabel, actionIcon)
            pendingMute = (muteShow, muteOn)
            return
        }
        // 사라질 때는 빠르게(0.14s), 나타날 때는 기존 속도(0.2s).
        // 뒤로가기 슬라이드(0.34s) 도중 상단 버튼이 남아 겹쳐 보이던 문제 보정.
        let anyHiding = (!back && (backHost?.alpha ?? 0) > 0)
            || (!followShow && (followHost?.alpha ?? 0) > 0)
            || (!muteShow && (muteHost?.alpha ?? 0) > 0)
        UIView.animate(withDuration: anyHiding ? 0.14 : 0.2) {
            self.backHost?.alpha = back ? 1 : 0
            self.followHost?.alpha = followShow ? 1 : 0
            self.actionHost?.alpha = actionShow ? 1 : 0
            self.muteHost?.alpha = muteShow ? 1 : 0
        }
        // 켜짐이면 브랜드 옐로 벨, 꺼짐이면 사선 벨(회색)
        let mcfg = UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)
        muteIcon?.image = UIImage(systemName: muteOn ? "bell.slash.fill" : "bell.fill", withConfiguration: mcfg)
        muteIcon?.tintColor = muteOn ? UIColor.white.withAlphaComponent(0.55)
                                     : UIColor(red: 0.96, green: 0.77, blue: 0.0, alpha: 1)
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
        let tvc = UITabBarController()
        tvc.viewControllers = tabs.enumerated().map { i, t in
            let vc = UIViewController()
            vc.view.backgroundColor = .clear                 // content stays see-through
            vc.view.isUserInteractionEnabled = false
            // 웹 탭바와 동일한 커스텀 SVG 아이콘(Assets: tab-*) — SF Symbol은
            // 아웃라인이어도 내부 디테일(달력 점·신문 선)이 많아 복잡해 보인다.
            let icon = UIImage(named: "tab-\(t.id)") ?? UIImage(systemName: t.symbol)
            vc.tabBarItem = UITabBarItem(title: t.label, image: icon, tag: i)
            vc.tabBarItem.selectedImage = icon
            return vc
        }
        tvc.delegate = self
        tvc.tabBar.tintColor = UIColor(red: 0.961, green: 0.769, blue: 0.0, alpha: 1) // #f5c400
        tvc.view.backgroundColor = .clear

        addChild(tvc)
        let wrap = TabBarPassthroughView()
        wrap.passthroughTarget = tvc.tabBar
        wrap.translatesAutoresizingMaskIntoConstraints = false
        tvc.view.translatesAutoresizingMaskIntoConstraints = false
        wrap.addSubview(tvc.view)
        view.addSubview(wrap)
        NSLayoutConstraint.activate([
            // Full-screen so UIKit lays the bar out with its own safe-area rules.
            wrap.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            wrap.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            wrap.topAnchor.constraint(equalTo: view.topAnchor),
            wrap.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            tvc.view.leadingAnchor.constraint(equalTo: wrap.leadingAnchor),
            tvc.view.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
            tvc.view.topAnchor.constraint(equalTo: wrap.topAnchor),
            tvc.view.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
        ])
        tvc.didMove(toParent: self)
        tabBarVC = tvc
        hostView = wrap

        // Stay hidden beneath the launch splash, then fade in with the app.
        wrap.alpha = 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.9) { [weak self] in
            UIView.animate(withDuration: 0.45, delay: 0, options: [.curveEaseOut]) { wrap.alpha = 1 }
            // 전환이 끝난 지금부터 웹이 요청한 크롬 상태를 반영한다.
            guard let self = self else { return }
            self.chromeReady = true
            if let b = self.pendingBell { self.pendingBell = nil; self.updateBell(show: b.show, unread: b.unread) }
            if let d = self.pendingDetail {
                self.pendingDetail = nil
                self.updateDetailChrome(back: d.back, followShow: d.followShow, followOn: d.followOn,
                                        actionShow: d.actionShow, actionLabel: d.actionLabel, actionIcon: d.actionIcon)
            }
        }
    }

    // System tab bar tap → haptic + drive the web app.
    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        let i = viewController.tabBarItem.tag
        guard i >= 0 && i < tabs.count else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()   // GNB 탭 햅틱
        wk?.evaluateJavaScript("window.__nativeTab && window.__nativeTab('\(tabs[i].id)')")
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
           let i = tabs.firstIndex(where: { $0.id == id }),
           let tvc = tabBarVC, i != tvc.selectedIndex {
            tvc.selectedIndex = i   // web-driven change (e.g. notification tap) → sync system bar
        } else if message.name == "bell", let d = message.body as? [String: Any] {
            updateBell(show: (d["show"] as? Bool) ?? false, unread: (d["unread"] as? Int) ?? 0)
        } else if message.name == "detailbar", let d = message.body as? [String: Any] {
            let action = d["action"] as? [String: Any]
            updateDetailChrome(back: (d["back"] as? Bool) ?? false,
                               followShow: (d["followShow"] as? Bool) ?? false,
                               followOn: (d["followOn"] as? Bool) ?? false,
                               actionShow: (action?["show"] as? Bool) ?? false,
                               actionLabel: (action?["label"] as? String) ?? "",
                               actionIcon: (action?["icon"] as? String) ?? "",
                               muteShow: (d["muteShow"] as? Bool) ?? false,
                               muteOn: (d["muteOn"] as? Bool) ?? false)
        } else if message.name == "openurl", let urlStr = message.body as? String,
                  let url = URL(string: urlStr), url.scheme?.hasPrefix("http") == true {
            presentInAppBrowser(url)
        }
    }

    /// 인앱 브라우저를 시트로 띄운다. @capacitor/browser 는 fullScreen/popover 만
    /// 지원해 아래로 스와이프해 닫을 수 없다 — pageSheet 로 직접 표시해
    /// '아래에서 위로 등장 + 스와이프 다운으로 닫기'를 얻는다.
    private func presentInAppBrowser(_ url: URL) {
        let cfg = SFSafariViewController.Configuration()
        cfg.entersReaderIfAvailable = false
        let vc = SFSafariViewController(url: url, configuration: cfg)
        vc.modalPresentationStyle = .pageSheet
        vc.preferredControlTintColor = UIColor(red: 0.96, green: 0.77, blue: 0.0, alpha: 1)
        if let sheet = vc.sheetPresentationController {
            sheet.detents = [.large()]
            sheet.prefersGrabberVisible = true
            sheet.preferredCornerRadius = 16
        }
        (presentedViewController ?? self).present(vc, animated: true)
    }
}
