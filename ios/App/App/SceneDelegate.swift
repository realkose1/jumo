import UIKit
import Capacitor

// iOS 27 SDK 부터 UIScene 라이프사이클이 필수다(미채택 앱은 실행 즉시 SIGTRAP).
// 창은 Info.plist 의 UISceneStoryboardFile(Main)이 만든다. 여기서는 AppDelegate 가
// 받던 URL·유니버설 링크를 Capacitor 로 넘기는 일만 한다.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // 콜드 스타트: 링크로 실행되면 application(_:open:) 대신 여기로 온다.
        // 브리지가 아직 없어 appUrlOpen 은 못 받지만 lastURL 이 남아 JS 의 getLaunchUrl 이 읽는다.
        if let context = connectionOptions.urlContexts.first {
            openURL(context)
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        URLContexts.forEach(openURL)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }

    private func openURL(_ context: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = context.options.sourceApplication { options[.sourceApplication] = source }
        if let annotation = context.options.annotation { options[.annotation] = annotation }
        options[.openInPlace] = context.options.openInPlace
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
    }
}
