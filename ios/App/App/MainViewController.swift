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
    private var iconViews: [UIImageView] = []
    private var labels: [UILabel] = []
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
            let glass = UIGlassEffect()
            glass.isInteractive = true   // liquid reacts to touch & drag
            bg = UIVisualEffectView(effect: glass)
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
            // Build the icon + label manually and pin the vertical stack to the
            // button's center — guarantees both are perfectly centered (the
            // Configuration-based layout was drifting off-center).
            let iv = UIImageView(image: UIImage(systemName: t.symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .medium)))
            iv.contentMode = .center
            iv.tintColor = .secondaryLabel
            iv.setContentHuggingPriority(.required, for: .horizontal)

            let lb = UILabel()
            lb.text = t.label
            lb.font = .systemFont(ofSize: 10, weight: .semibold)
            lb.textColor = .secondaryLabel
            lb.textAlignment = .center

            let v = UIStackView(arrangedSubviews: [iv, lb])
            v.axis = .vertical
            v.alignment = .center
            v.spacing = 3
            v.isUserInteractionEnabled = false
            v.translatesAutoresizingMaskIntoConstraints = false

            let b = UIButton(type: .custom)
            b.tag = i
            b.addSubview(v)
            NSLayoutConstraint.activate([
                v.centerXAnchor.constraint(equalTo: b.centerXAnchor),
                v.centerYAnchor.constraint(equalTo: b.centerYAnchor)
            ])
            b.addTarget(self, action: #selector(tabTapped(_:)), for: .touchUpInside)
            buttons.append(b)
            iconViews.append(iv)
            labels.append(lb)
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
        for i in buttons.indices {
            let on = (i == idx)
            iconViews[i].tintColor = on ? .label : .secondaryLabel
            labels[i].textColor = on ? .label : .secondaryLabel
        }
        let target = buttons[idx]
        let move = { self.pill.frame = target.frame.insetBy(dx: 6, dy: 4) }
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
