import UIKit
import Capacitor
import GoogleSignIn

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = WineForestViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        for ctx in connectionOptions.urlContexts {
            _ = GIDSignIn.sharedInstance.handle(ctx.url)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        var unhandled = Set<UIOpenURLContext>()
        for ctx in URLContexts {
            if !GIDSignIn.sharedInstance.handle(ctx.url) {
                unhandled.insert(ctx)
            }
        }
        if !unhandled.isEmpty {
            SceneDelegateProxy.shared.scene(scene, openURLContexts: unhandled)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
