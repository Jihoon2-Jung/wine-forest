import UIKit
import Capacitor

class WineForestViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(GoogleDriveAuthPlugin())
    }
}
