import React, { Suspense, lazy, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./refinements.css";
import "./workbench/workbench.css";
import UpdateCenter from './modules/UpdateCenter';
import './modules/updates.css';
const App = lazy(() => import("./App")),
  VideoStudio = lazy(() => import("./video/VideoStudio"));
class RecoveryBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || "Erreur inattendue" };
  }
  render() {
    if (this.state.error)
      return (
        <main className="recovery-screen">
          <div>
            <h1>Le studio a rencontré un problème.</h1>
            <p>
              Vos fichiers restent conservés. Rouvrez le studio pour reprendre
              depuis les derniers changements enregistrés.
            </p>
            <button onClick={() => location.reload()}>Rouvrir le studio</button>
            <details>
              <summary>Détail du problème</summary>
              {this.state.error}
            </details>
          </div>
        </main>
      );
    return this.props.children;
  }
}
function Studio() {
  const [mode, setMode] = useState(
    localStorage.getItem("juno-workspace") || "photo",
  );
  const choose = (m: string) => {
    localStorage.setItem("juno-workspace", m);
    setMode(m);
  };
  return (
    <Suspense
      fallback={
        <div
          style={{
            display: "grid",
            placeItems: "center",
            height: "100vh",
            background: "#13191f",
            color: "#dce7a2",
          }}
        >
          Ouverture de Juno…
        </div>
      }
    >
      {mode === "video" ? (
        <VideoStudio onPhoto={() => choose("photo")} />
      ) : (
        <App onVideo={() => choose("video")} />
      )}
      <UpdateCenter />
    </Suspense>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RecoveryBoundary>
      <Studio />
    </RecoveryBoundary>
  </React.StrictMode>,
);
