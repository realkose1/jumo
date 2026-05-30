import UIKit
import WebKit
import Capacitor

// Native iOS 26 Liquid Glass tab bar overlaid on the Capacitor WKWebView.
// The web app's CSS tab bar is hidden (window.__enableNativeTabBar) and tab
// taps are bridged into the web app (window.__nativeTab). When the web app
// changes tab itself it posts back via the "tabbar" message handler so the
// native highlight stays in sync.
class MainViewController: CAPBridgeViewController, WKScriptMessageHandler {

    private let tabs: [(id: String, label: String, symbol: String)] = [
        ("home",     "홈",     "house.fill"),
        ("schedule", "일정",   "calendar"),
        ("players",  "선수",   "person.fill"),
        ("news",     "뉴스",   "newspaper.fill"),
        ("more",     "더보기", "ellipsis")
    ]
    private var buttons: [UIButton] = []
    private var activeId = "home"
    private let pill = UIView()
    private var didSetup = false

    private var wk: WKWebView? { self.webView as? WKWebView }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if !didSetup {
            didSetup = true
            wk?.configuration.userContentController.add(self, name: "tabbar")
            setupTabBar()
            enableWebNativeTabBar()
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

    private func setupTabBar() {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false

        let bg: UIView
        if #available(iOS 26.0, *) {
            bg = UIVisualEffectView(effect: UIGlassEffect())
        } else {
            bg = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
        }
        bg.translatesAutoresizingMaskIntoConstraints = false
        bg.layer.cornerRadius = 30
        bg.layer.cornerCurve = .continuous
        bg.clipsToBounds = true
        container.addSubview(bg)
        view.addSubview(container)

        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            container.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -6),
            container.heightAnchor.constraint(equalToConstant: 60),
            bg.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            bg.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            bg.topAnchor.constraint(equalTo: container.topAnchor),
            bg.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])

        let host = (bg as? UIVisualEffectView)?.contentView ?? bg

        pill.backgroundColor = UIColor.white.withAlphaComponent(0.18)
        pill.layer.cornerRadius = 17
        pill.layer.cornerCurve = .continuous
        pill.isUserInteractionEnabled = false
        host.addSubview(pill)

        let stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: host.trailingAnchor, constant: -6),
            stack.topAnchor.constraint(equalTo: host.topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: host.bottomAnchor, constant: -6)
        ])

        for (i, t) in tabs.enumerated() {
            var cfg = UIButton.Configuration.plain()
            cfg.image = UIImage(systemName: t.symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold))
            cfg.title = t.label
            cfg.imagePlacement = .top
            cfg.imagePadding = 3
            cfg.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 2, bottom: 4, trailing: 2)
            cfg.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
                var out = incoming
                out.font = .systemFont(ofSize: 10, weight: .semibold)
                return out
            }
            let b = UIButton(configuration: cfg)
            b.tag = i
            b.tintColor = .secondaryLabel
            b.addTarget(self, action: #selector(tabTapped(_:)), for: .touchUpInside)
            buttons.append(b)
            stack.addArrangedSubview(b)
        }
        view.layoutIfNeeded()
        updateHighlight(animated: false)
    }

    @objc private func tabTapped(_ sender: UIButton) {
        let t = tabs[sender.tag]
        setActive(t.id, animated: true)
        wk?.evaluateJavaScript("window.__nativeTab && window.__nativeTab('\(t.id)')")
    }

    private func setActive(_ id: String, animated: Bool) {
        activeId = id
        updateHighlight(animated: animated)
    }

    private func updateHighlight(animated: Bool) {
        guard let idx = tabs.firstIndex(where: { $0.id == activeId }), idx < buttons.count else { return }
        for (i, b) in buttons.enumerated() {
            b.configuration?.baseForegroundColor = (i == idx) ? .label : .secondaryLabel
        }
        let target = buttons[idx]
        let move = { self.pill.frame = target.frame.insetBy(dx: 5, dy: 4) }
        if animated {
            UIView.animate(withDuration: 0.24, delay: 0, usingSpringWithDamping: 0.82, initialSpringVelocity: 0.3, options: [.curveEaseOut], animations: move)
        } else {
            move()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if pill.superview != nil { updateHighlight(animated: false) }
    }

    // web → native: keep native highlight in sync when the web changes tab
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "tabbar", let id = message.body as? String, id != activeId {
            setActive(id, animated: true)
        }
    }
}
