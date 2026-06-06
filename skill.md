---
name: liquid-glass-native
description: Apply real iOS 26 Liquid Glass (UIGlassEffect / SwiftUI .glassEffect) to custom UI — native glass chrome overlaid on a Capacitor/WKWebView app, glass tab bars, floating glass buttons, morphing selection pills, and glass headers. Use when CSS backdrop-filter "looks fake" and the user wants the genuine refractive Apple material. Distilled from shipping the Jumo app.
---

# Native Liquid Glass — practical skill

Hard-won recipes + gotchas for the **genuine** iOS 26 glass material, not the CSS
imitation. The #1 lesson: when someone says "it looks foggy / fake / not glass,"
it's almost always one of the gotchas below — not a tuning problem.

## 0. Decide: native vs CSS
- **CSS `backdrop-filter: blur() saturate()`** is fine for *web headers / scroll-edge
  effects* (content blurs through as it scrolls under a sticky bar). Cheap, reliable.
- **Native `UIGlassEffect` / SwiftUI `.glassEffect()`** is for *chrome that must look
  like Apple's material* — tab bars, floating buttons. It refracts (lenses) content
  with specular edges; CSS can't. If the user rejects the CSS look, go native.
- In a **Capacitor/WKWebView** app, native glass = a UIKit/SwiftUI overlay on the
  bridge view controller, driven by a JS↔native bridge (below).

## 1. The real API (check the SDK header, don't guess)
`xcrun --sdk iphoneos --show-sdk-path` → `…/UIKit.framework/Headers/UIGlassEffect.h`:
```objc
typedef NS_ENUM(NSInteger, UIGlassEffectStyle) { UIGlassEffectStyleRegular, UIGlassEffectStyleClear };
@interface UIGlassEffect : UIVisualEffect
@property(nonatomic, getter=isInteractive) BOOL interactive;   // expands/highlights on touch
@property(nonatomic, copy, nullable) UIColor *tintColor;
+ (UIGlassEffect *)effectWithStyle:(UIGlassEffectStyle)style;  // Swift: UIGlassEffect(style:)
@end
@interface UIGlassContainerEffect : UIVisualEffect { @property CGFloat spacing; }  // merges nested glass
```
SwiftUI: `.glassEffect(.clear.interactive(), in: .capsule)`, `GlassEffectContainer(spacing:)`,
`.glassEffectID(id, in: namespace)` for morphing, glass styles `.regular`/`.clear`/`.identity`.

## 2. GOTCHAS (this is the whole skill)

1. **`.regular` is frosty/milky; `.clear` is the crisp lens.** The default
   `UIGlassEffect()` / `.glassEffect()` is `.regular` (medium frost). If it "looks
   like a foggy blob," switch to **`.clear`**. Use `.regular` only for a defined bar
   *background*; use `.clear` for selection pills / buttons that should refract.

2. **Glass can't sample other glass.** Stacking a glass pill *on top of* a glass bar
   double-frosts → flat/foggy. Put both in **one `GlassEffectContainer`** (it
   composites them into a single layer that samples the *content* behind, not each
   other). This single rule fixed more "fake glass" complaints than anything else.

3. **Content inside the container gets vibrancy → dims.** Icons/labels placed *inside*
   the glass container lose contrast (look faint). Keep glyphs as a **separate top
   layer** (`HStack { … }.allowsHitTesting(false)`) above the glass, not in it.
   Tint the selected glyph the accent color; the **pill/area stays neutral glass**
   (users usually want "icon yellow, not the whole pill yellow").

4. **`.interactive()` (native expand-on-touch) fights custom gestures.** The glass only
   expands if *it* receives the touch — but a gesture overlay you need for tap/drag
   steals it, and routing touches *through* non-hittable layers to the glass is
   flaky. Pragmatic win: keep **one `Color.clear.contentShape(Rectangle()).gesture()`
   overlay** for reliable tap+drag, and do a **manual spring "expand"** (grow the
   pill frame while `pressed`). It reads identically and never breaks.

5. **The Simulator renders glass much foggier than a device.** Don't judge final
   crispness from `simctl` screenshots — verify layout/morph/color there, confirm the
   *look* on hardware. Tell the user this up front to save round-trips.

6. **Morph = `glassEffectID` + animate position, inside the container.** A selection
   pill that moves between cells: give it a stable `glassEffectID("sel")` and animate
   `model.selected` with a spring; the container makes it flow like liquid. For a
   Baemin-style drag-stretch, animate the pill's frame from origin→finger on a pan,
   snap on release.

7. **Capsule shape: prefer `cornerConfiguration = .capsule()` (UIKit) so the glass
   shape stays morph-able.** If you need a visible rim/border, use
   `layer.cornerRadius + layer.borderWidth` instead (border follows the layer corner,
   not `cornerConfiguration`).

## 3. Hosting native glass over a Capacitor WKWebView
Subclass `CAPBridgeViewController`. In `viewDidAppear` (once), overlay a
`UIHostingController` (SwiftUI glass) or a `UIVisualEffectView` (UIKit) pinned with
Auto Layout; set `hc.view.backgroundColor = .clear`. The glass **samples the webview
pixels behind it**, so let web content scroll *under* the bar (web `paddingBottom: 0`)
to get real refraction. Fade the overlay in after the splash so it doesn't sit on it.

## 4. JS ↔ native bridge (the glue)
- **native → web**: `wk.evaluateJavaScript("window.__fn && window.__fn(arg)")`.
  Web exposes `window.__nativeTab`, `window.__scrollTop`, `window.__back`,
  `window.__jumoNotif`, etc. (`React.useEffect` assigns the latest closure).
- **web → native**: `window.webkit.messageHandlers.<name>.postMessage(payload)`;
  native registers `userContentController.add(self, name:)` + implements
  `userContentController(_:didReceive:)`. Use it to **show/hide native overlays per
  screen** (e.g. post `{show, unread}` so a glass bell only appears on home) and to
  keep a native selection in sync.
- Hide the **web** equivalent when native is active (`{!nativeTabBar && <CssBar/>}`)
  so you don't get a double UI.

## 5. Concrete recipes (from Jumo)
**Glass tab bar** — `GlassEffectContainer { ZStack { bar `.glassEffect(.clear)`;
selection pill `.glassEffect(.clear.interactive())`.glassEffectID("sel") } } ` + crisp
glyph `HStack`.allowsHitTesting(false) on top + a clear gesture overlay (tap+drag,
manual `pressed` expand). Selected glyph = brand accent; pill = neutral glass.

**Floating glass button (notif bell)** — circular `UIVisualEffectView(UIGlassEffect(
style: .regular)` `isInteractive`), `layer.cornerRadius = size/2`, SF Symbol centered
in `contentView`, an overflowing badge `UILabel` in a wrapper, pinned to
`safeAreaLayoutGuide.top`/`trailing`; `alpha=0` until a `bell` bridge message says
`show`. Tap → bridge to the web action.

## 6. Verify checklist
- [ ] One container, no glass-on-glass.
- [ ] `.clear` for refractive elements; glyphs crisp on a separate non-hittable layer.
- [ ] Tap **and** drag work (gesture overlay); selection morphs (glassEffectID).
- [ ] Native overlay shows/hides per screen via bridge; web twin hidden.
- [ ] Accessibility: respect Reduce Transparency / Reduce Motion.
- [ ] Judged on a **real device**, not the Simulator.
