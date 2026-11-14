import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IntelQA CBT",
    short_name: "IntelQA",
    description: "Past questions, a real CBT timer, and every answer explained.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#5B3DF5",
    theme_color: "#5B3DF5",
    categories: ["education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
    ],
  };
}
