import UIKit
import WebKit
import Capacitor

// Native iOS 26 Liquid Glass tab bar overlaid on the Capacitor WKWebView.
// - Real UIGlassEffect (content refracts through the bar).
// - A glass selection "pill" that the user can DRAG: it follows the finger in
//   real time (liquid), then snaps to the tab on release. Tap also works.
// - Bridges tab changes to the web app (window.__nativeTab) and hides the web
//   app's own CSS tab bar (window.__enableNativeTabBar).
class MainViewController: CAPBridgeViewController, WKScriptMessageHandler {

    private let tabs: [(id: String, label: String, symbol: String)] = [
        ("home",     "홈",     "house.fill"),
        ("schedule", "일정",   "calendar"),
        ("players",  "선수",   "person.fill"),
        ("news",     "뉴스",   "newspaper.fill"),
        ("more",     "더보기", "ellipsis")
    ]
    private var cells: [UIView] = []          // one container per tab (icon + label)
    private var iconViews: [UIImageView] = []
    private var labels: [UILabel] = []
    private var activeIndex = 0
    private let pill = UIView()                // glass-tinted selection indicator
    private var host: UIView!                  // the bar's content view (pill + cells live here)
    private var stack: UIStackView!
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

        let bar: UIView
        if #available(iOS 26.0, *) {
            let glass = UIGlassEffect()
            glass.isInteractive = true
            bar = UIVisualEffectView(effect: glass)
        } else {
            bar = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
        }
        bar.translatesAutoresizingMaskIntoConstraints = false
        bar.layer.cornerRadius = 30
        bar.layer.cornerCurve = .continuous
        bar.clipsToBounds = true
        container.addSubview(bar)
        view.addSubview(container)

        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            container.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -6),
            container.heightAnchor.constraint(equalToConstant: 60),
            bar.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            bar.topAnchor.constraint(equalTo: container.topAnchor),
            bar.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])

        host = (bar as? UIVisualEffectView)?.contentView ?? bar

        // Selection pill (glass-like): a soft white capsule that follows selection.
        pill.backgroundColor = UIColor.white.withAlphaComponent(0.20)
        pill.layer.cornerRadius = 17
        pill.layer.cornerCurve = .continuous
        pill.layer.borderWidth = 0.5
        pill.layer.borderColor = UIColor.white.withAlphaComponent(0.30).cgColor
        pill.isUserInteractionEnabled = false
        host.addSubview(pill)

        stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.isUserInteractionEnabled = false   // gestures are handled on host
        stack.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: host.trailingAnchor, constant: -6),
            stack.topAnchor.constraint(equalTo: host.topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: host.bottomAnchor, constant: -6)
        ])

        for t in tabs {
            let iv = UIImageView(image: UIImage(systemName: t.symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .medium)))
            iv.contentMode = .center
            iv.tintColor = .secondaryLabel

            let lb = UILabel()
            lb.text = t.label
            lb.font = .systemFont(ofSize: 10, weight: .semibold)
            lb.textColor = .secondaryLabel
            lb.textAlignment = .center

            let v = UIStackView(arrangedSubviews: [iv, lb])
            v.axis = .vertical
            v.alignment = .center
            v.spacing = 3
            v.translatesAutoresizingMaskIntoConstraints = false

            let cell = UIView()
            cell.addSubview(v)
            NSLayoutConstraint.activate([
                v.centerXAnchor.constraint(equalTo: cell.centerXAnchor),
                v.centerYAnchor.constraint(equalTo: cell.centerYAnchor)
            ])
            cells.append(cell)
            iconViews.append(iv)
            labels.append(lb)
            stack.addArrangedSubview(cell)
        }

        // Tap to select, pan to drag the pill in real time.
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        host.addGestureRecognizer(tap)
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        host.addGestureRecognizer(pan)

        view.layoutIfNeeded()
        movePill(to: activeIndex, animated: false)
        updateColors(highlight: activeIndex)
    }

    // MARK: - selection / pill

    private func cellFrameInHost(_ i: Int) -> CGRect {
        return cells[i].convert(cells[i].bounds, to: host)
    }

    private func movePill(to index: Int, animated: Bool) {
        guard index >= 0, index < cells.count else { return }
        let target = cellFrameInHost(index).insetBy(dx: 6, dy: 4)
        let apply = { self.pill.frame = target }
        if animated {
            UIView.animate(withDuration: 0.28, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0.4, options: [.curveEaseOut], animations: apply)
        } else { apply() }
    }

    // Pill centered on an arbitrary x (used while dragging) — keeps the pill width.
    private func movePill(toX x: CGFloat) {
        let w = (cellFrameInHost(0).width) - 12
        let half = w / 2
        let minX = (host.bounds.minX) + 6 + half
        let maxX = (host.bounds.maxX) - 6 - half
        let cx = min(max(x, minX), maxX)
        var f = pill.frame
        f.size.width = w
        f.origin.x = cx - half
        pill.frame = f
    }

    private func index(atX x: CGFloat) -> Int {
        guard !cells.isEmpty else { return 0 }
        let inner = host.bounds.insetBy(dx: 6, dy: 0)
        let rel = (x - inner.minX) / max(1, inner.width)
        return min(max(Int(rel * CGFloat(cells.count)), 0), cells.count - 1)
    }

    private func updateColors(highlight i: Int) {
        for k in cells.indices {
            let on = (k == i)
            iconViews[k].tintColor = on ? .label : .secondaryLabel
            labels[k].textColor = on ? .label : .secondaryLabel
        }
    }

    private func selectTab(_ i: Int, fromWeb: Bool = false) {
        activeIndex = i
        movePill(to: i, animated: true)
        updateColors(highlight: i)
        if !fromWeb {
            wk?.evaluateJavaScript("window.__nativeTab && window.__nativeTab('\(tabs[i].id)')")
        }
    }

    // MARK: - gestures

    @objc private func handleTap(_ g: UITapGestureRecognizer) {
        selectTab(index(atX: g.location(in: host).x))
    }

    @objc private func handlePan(_ g: UIPanGestureRecognizer) {
        let x = g.location(in: host).x
        switch g.state {
        case .changed:
            let i = index(atX: x)
            movePill(toX: x)            // real-time follow (liquid)
            updateColors(highlight: i)
        case .ended, .cancelled, .failed:
            selectTab(index(atX: x))
        default:
            break
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if pill.superview != nil { movePill(to: activeIndex, animated: false) }
    }

    // web → native: keep the native selection in sync when the web changes tab
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "tabbar", let id = message.body as? String,
           let i = tabs.firstIndex(where: { $0.id == id }), i != activeIndex {
            selectTab(i, fromWeb: true)
        }
    }
}
