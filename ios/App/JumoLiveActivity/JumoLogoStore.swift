import Foundation
#if canImport(UIKit)
import UIKit
#endif

// 팀 엠블럼을 앱과 위젯이 함께 쓰는 저장소.
//
// 왜 이런 게 필요한가: 라이브 액티비티 뷰는 **동기적으로** 그려진다. 위젯
// 익스텐션에서는 AsyncImage 도, URLSession 도 쓸 수 없고, ActivityKit 의
// 콘텐츠 상태(4KB)에 이미지를 실을 수도 없다. 그렇다고 로고를 앱 번들에 미리
// 넣어둘 수도 없다 — 상대 팀은 리그 전체라 미리 알 수 없기 때문이다.
//
// 그래서 **네트워크가 되는 앱 쪽에서 미리 내려받아** App Group 공유 컨테이너에
// 저장하고, 위젯은 그 파일을 디스크에서 바로 읽는다. 파일명은 URL 해시라
// 같은 팀 로고는 앱 생애 통틀어 한 번만 받는다.
enum JumoLogoStore {
    static let appGroup = "group.com.realkose.jumo"

    private static var dir: URL? {
        let fm = FileManager.default
        guard let base = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        let d = base.appendingPathComponent("logos", isDirectory: true)
        if !fm.fileExists(atPath: d.path) {
            try? fm.createDirectory(at: d, withIntermediateDirectories: true)
        }
        return d
    }

    /// URL -> 짧고 안정적인 파일명. (djb2)
    private static func fileName(for url: String) -> String {
        var h: UInt64 = 5381
        for b in url.utf8 { h = h &* 33 &+ UInt64(b) }
        return String(h, radix: 36) + ".png"
    }

    /// 위젯·앱 공용 — 저장돼 있으면 경로를, 없으면 nil.
    static func localPath(_ name: String) -> String? {
        guard !name.isEmpty, let d = dir else { return nil }
        let p = d.appendingPathComponent(name).path
        return FileManager.default.fileExists(atPath: p) ? p : nil
    }

    /// 앱 전용 — 로고를 받아 캐시하고 파일명을 돌려준다. 실패하면 빈 문자열
    /// (위젯이 팀 약칭 배지로 알아서 대체한다).
    static func cache(_ urlString: String) async -> String {
        guard !urlString.isEmpty, let d = dir, let url = URL(string: urlString) else { return "" }
        let name = fileName(for: urlString)
        let dest = d.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: dest.path) { return name }
        do {
            var req = URLRequest(url: url)
            req.timeoutInterval = 5   // 액티비티 시작을 오래 붙잡아두지 않는다
            let (data, _) = try await URLSession.shared.data(for: req)
            guard !data.isEmpty else { return "" }
            try (downscaled(data) ?? data).write(to: dest, options: .atomic)
            return name
        } catch {
            return ""
        }
    }

    /// 위젯은 메모리 한도가 빠듯하다 — 96pt 면 충분하므로 줄여서 저장한다.
    private static func downscaled(_ data: Data) -> Data? {
        #if canImport(UIKit)
        guard let img = UIImage(data: data) else { return nil }
        let target: CGFloat = 96
        let longest = max(img.size.width, img.size.height)
        guard longest > target, longest > 0 else { return img.pngData() }
        let scale = target / longest
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.opaque = false
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).pngData { _ in
            img.draw(in: CGRect(origin: .zero, size: size))
        }
        #else
        return nil
        #endif
    }
}
