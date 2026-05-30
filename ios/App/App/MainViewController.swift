import UIKit
import WebKit
import Capacitor

// Native iOS 26 Liquid Glass tab bar overlaid on the Capacitor WKWebView.
//
// Uses UIGlassContainerEffect (the "glass union" container) holding two glass
// elements — the bar capsule and a brighter selection pill. Because both live
// in the same container, the pill morphs/blends like liquid as it moves. The
// pill follows the finger on drag and snaps to a tab on release; tapping works
// too. Tab changes bridge to the web app (window.__nativeTab) and the web app
// hides its own CSS tab bar (window.__enableNativeTabBar).
class MainViewController: CAPBridgeViewController, WKScriptMessageHandler {

    private let tabs: [(id: String, label: String, symbol: String)] = [
        ("home",     "홈",     "house.fill"),
        ("schedule", "일정",   "calendar"),
        ("players",  "선수",   "person.fill"),
        ("news",     "뉴스",   "newspaper.fill"),
        ("more",     "더보기", "ellipsis")
    ]

    // Brand accent (matches web --acc #f5c400)
    static let brandYellow = UIColor(red: 0.961, green: 0.769, blue: 0.0, alpha: 1.0)

    // Layout constants (HIG-ish floating tab bar)
    private let barHeight: CGFloat = 56
    private let sideInset: CGFloat = 16
    private let bottomGap: CGFloat = 4
    private let pillInsetX: CGFloat = 4
    private let pillInsetY: CGFloat = 4

    private var cells: [UIView] = []
    private var iconViews: [UIImageView] = []
    private var labels: [UILabel] = []
    private var activeIndex = 0
    private var isDragging = false
    private var dragStartCenterX: CGFloat = 0

    private var host: UIView!          // container.contentView (everything lives here)
    private var pill: UIView!          // glass selection indicator
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

    private func setRoundedCorners(_ v: UIView, radius: CGFloat) {
        // Prefer the iOS 26 corner configuration (keeps glass shape morph-able);
        // fall back to layer corners on older systems.
        if #available(iOS 26.0, *) {
            v.cornerConfiguration = .capsule()
        } else {
            v.layer.cornerRadius = radius
            v.layer.cornerCurve = .continuous
            v.clipsToBounds = true
        }
    }

    private func setupTabBar() {
        // ── Glass union container ────────────────────────────────────────────
        let container: UIVisualEffectView
        if #available(iOS 26.0, *) {
            let ce = UIGlassContainerEffect()
            ce.spacing = 10   // merge threshold for the morph
            container = UIVisualEffectView(effect: ce)
        } else {
            container = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterialDark))
        }
        container.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(container)
        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: sideInset),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -sideInset),
            container.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -bottomGap),
            container.heightAnchor.constraint(equalToConstant: barHeight)
        ])
        host = container.contentView

        // ── Bar capsule (base glass) ─────────────────────────────────────────
        let barGlass: UIView
        if #available(iOS 26.0, *) {
            let e = UIGlassEffect(style: .clear)   // clear = crisp see-through glass (not frosted)
            barGlass = UIVisualEffectView(effect: e)
        } else {
            barGlass = UIView()
            barGlass.backgroundColor = UIColor.black.withAlphaComponent(0.35)
        }
        barGlass.translatesAutoresizingMaskIntoConstraints = false
        setRoundedCorners(barGlass, radius: barHeight / 2)
        host.addSubview(barGlass)
        NSLayoutConstraint.activate([
            barGlass.leadingAnchor.constraint(equalTo: host.leadingAnchor),
            barGlass.trailingAnchor.constraint(equalTo: host.trailingAnchor),
            barGlass.topAnchor.constraint(equalTo: host.topAnchor),
            barGlass.bottomAnchor.constraint(equalTo: host.bottomAnchor)
        ])

        // ── Selection pill (clear glass capsule; the AREA is neutral glass, only
        //    the icon+label are tinted yellow) ─────────────────────────────────
        if #available(iOS 26.0, *) {
            let e = UIGlassEffect(style: .clear)   // clear glass → crisp lensing, not milky frost
            e.isInteractive = true
            e.tintColor = UIColor.white.withAlphaComponent(0.10)  // neutral lift, NOT colored
            pill = UIVisualEffectView(effect: e)
        } else {
            let p = UIView(); p.backgroundColor = UIColor.white.withAlphaComponent(0.16); pill = p
        }
        pill.isUserInteractionEnabled = false
        let pillRadius = (barHeight - 12 - 2 * pillInsetY) / 2    // cell(44) → 36 tall → r=18
        pill.layer.cornerRadius = pillRadius
        pill.layer.cornerCurve = .continuous
        pill.clipsToBounds = true
        pill.layer.borderWidth = 1                                // crisp glass rim for definition
        pill.layer.borderColor = UIColor.white.withAlphaComponent(0.40).cgColor
        host.addSubview(pill)

        // ── Icon + label cells (on top) ──────────────────────────────────────
        stack = UIStackView()
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.isUserInteractionEnabled = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: host.leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: host.trailingAnchor, constant: -6),
            stack.topAnchor.constraint(equalTo: host.topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: host.bottomAnchor, constant: -6)
        ])
        for t in tabs {
            let iv = UIImageView(image: UIImage(systemName: t.symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)))
            iv.contentMode = .center
            iv.tintColor = .secondaryLabel
            let lb = UILabel()
            lb.text = t.label
            lb.font = .systemFont(ofSize: 10, weight: .semibold)
            lb.textColor = .secondaryLabel
            lb.textAlignment = .center
            let v = UIStackView(arrangedSubviews: [iv, lb])
            v.axis = .vertical; v.alignment = .center; v.spacing = 3
            v.translatesAutoresizingMaskIntoConstraints = false
            let cell = UIView()
            cell.addSubview(v)
            NSLayoutConstraint.activate([
                v.centerXAnchor.constraint(equalTo: cell.centerXAnchor),
                v.centerYAnchor.constraint(equalTo: cell.centerYAnchor)
            ])
            cells.append(cell); iconViews.append(iv); labels.append(lb)
            stack.addArrangedSubview(cell)
        }

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        host.addGestureRecognizer(tap)
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        host.addGestureRecognizer(pan)

        view.layoutIfNeeded()
        movePill(to: activeIndex, animated: false)
        updateColors(highlight: activeIndex)

        // Stay hidden beneath the launch splash, then fade in with the app.
        container.alpha = 0
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.9) {
            UIView.animate(withDuration: 0.45, delay: 0, options: [.curveEaseOut]) { container.alpha = 1 }
        }
    }

    // MARK: - pill / selection

    private func cellFrameInHost(_ i: Int) -> CGRect { cells[i].convert(cells[i].bounds, to: host) }

    private func movePill(to index: Int, animated: Bool) {
        guard index >= 0, index < cells.count else { return }
        let target = cellFrameInHost(index).insetBy(dx: pillInsetX, dy: pillInsetY)
        let apply = { self.pill.frame = target }
        if animated {
            UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.78, initialSpringVelocity: 0.4, options: [.curveEaseOut], animations: apply)
        } else { apply() }
    }

    // Baemin-style liquid stretch: the pill elongates from the origin cell toward
    // the finger, then snaps to a single cell on release.
    private func stretchPill(fromX: CGFloat, toX: CGFloat) {
        let cell = cellFrameInHost(0).insetBy(dx: pillInsetX, dy: pillInsetY)
        let half = cell.width / 2
        let minC = 6 + pillInsetX + half
        let maxC = host.bounds.width - 6 - pillInsetX - half
        let f = min(max(fromX, minC), maxC)
        let t = min(max(toX,   minC), maxC)
        let left  = min(f, t) - half
        let right = max(f, t) + half
        let ref = cellFrameInHost(activeIndex).insetBy(dx: pillInsetX, dy: pillInsetY)
        pill.frame = CGRect(x: left, y: ref.minY, width: right - left, height: ref.height)
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
            let onColor = Self.brandYellow                         // vivid yellow glyph in the glass pill
            let offColor = UIColor.white.withAlphaComponent(0.62)  // muted on the dark glass bar
            iconViews[k].tintColor = on ? onColor : offColor
            labels[k].textColor = on ? onColor : offColor
        }
    }

    private func selectTab(_ i: Int, fromWeb: Bool = false) {
        activeIndex = i
        movePill(to: i, animated: true)
        updateColors(highlight: i)
        if !fromWeb { wk?.evaluateJavaScript("window.__nativeTab && window.__nativeTab('\(tabs[i].id)')") }
    }

    @objc private func handleTap(_ g: UITapGestureRecognizer) {
        selectTab(index(atX: g.location(in: host).x))
    }

    @objc private func handlePan(_ g: UIPanGestureRecognizer) {
        let x = g.location(in: host).x
        switch g.state {
        case .began:
            isDragging = true
            dragStartCenterX = cellFrameInHost(activeIndex).midX
            stretchPill(fromX: dragStartCenterX, toX: x)
            updateColors(highlight: index(atX: x))
        case .changed:
            stretchPill(fromX: dragStartCenterX, toX: x)
            updateColors(highlight: index(atX: x))
        case .ended, .cancelled, .failed:
            isDragging = false
            selectTab(index(atX: x))
        default: break
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if pill != nil, pill.superview != nil, !isDragging { movePill(to: activeIndex, animated: false) }
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "tabbar", let id = message.body as? String,
           let i = tabs.firstIndex(where: { $0.id == id }), i != activeIndex {
            selectTab(i, fromWeb: true)
        }
    }
}
