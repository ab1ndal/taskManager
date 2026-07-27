import type { MetadataRoute } from "next";

/**
 * Web app manifest. The same build is the iPhone deliverable: installed from Safari's share sheet
 * it launches standalone, with no browser chrome, which is what `display: "standalone"` and the
 * icons below buy. iOS reads `apple-icon.png` for the home-screen glyph rather than this list, so
 * both have to exist.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Hearth — household and work tasks",
    short_name: "Hearth",
    description: "Your household and work tasks, in one warm place.",
    start_url: "/tasks",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf9f7",
    theme_color: "#7c5cbf",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
