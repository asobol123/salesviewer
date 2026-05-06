import { createFileRoute } from "@tanstack/react-router";
import SalesViewerApp from "@/components/SalesViewerApp";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "SalesViewer – Verkaufsübersicht & Auswertung" },
      {
        name: "description",
        content:
          "Mobile Verkaufsübersicht: ZIP-Archive vom Verkäufer importieren, Statistiken und Fotos ansehen. Offline-fähig.",
      },
      { name: "theme-color", content: "#3b82f6" },
    ],
  }),
});

function Index() {
  return <SalesViewerApp />;
}
