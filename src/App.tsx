import { ModelProvider } from "./model";
import { usePlan } from "./store";
import { Board } from "./ui/Board";
import { CourseDetail } from "./ui/CourseDetail";
import { DndRoot } from "./ui/DndRoot";
import { Header } from "./ui/Header";
import { Projects } from "./ui/Projects";
import { RequirementsRail } from "./ui/RequirementsRail";
import { SemesterRail } from "./ui/SemesterRail";
import { Toast } from "./ui/Toast";
import { Tree } from "./ui/Tree";
import { WishlistBar } from "./ui/WishlistBar";

function Shell() {
  const mode = usePlan((s) => s.mode);
  const picking = usePlan((s) => s.picking);
  return (
    <DndRoot>
      <div className="flex h-full min-w-[1024px] flex-col">
        <Header />
        {picking && mode !== "projects" && <WishlistBar />}
        <div className="relative flex min-h-0 flex-1">
          <main className="min-w-0 flex-1">
            {mode === "board" ? (
              <Board />
            ) : mode === "tree" ? (
              <Tree />
            ) : (
              <Projects />
            )}
          </main>
          {mode !== "projects" && <RequirementsRail />}
          <CourseDetail />
          <Toast />
        </div>
        {mode !== "projects" && <SemesterRail />}
      </div>
    </DndRoot>
  );
}

export default function App() {
  return (
    <ModelProvider>
      <Shell />
    </ModelProvider>
  );
}
