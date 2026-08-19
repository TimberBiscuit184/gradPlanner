import { useState } from "react";
import { ModelProvider } from "./model";
import { useProfile } from "./profileStore";
import { usePlan } from "./store";
import { Board } from "./ui/Board";
import { CourseDetail } from "./ui/CourseDetail";
import { CoursePicker } from "./ui/CoursePicker";
import { DndRoot } from "./ui/DndRoot";
import { Header } from "./ui/Header";
import { PanelHost, usePanelInsets } from "./ui/panels/FloatingPanel";
import { Projects } from "./ui/Projects";
import { RequirementsRail } from "./ui/RequirementsRail";
import { SemesterRail } from "./ui/SemesterRail";
import { Toast } from "./ui/Toast";
import { Tree } from "./ui/Tree";
import { WishlistBar } from "./ui/WishlistBar";
import { Welcome, shouldWelcome } from "./ui/Welcome";

/**
 * The board / tree / projects canvas.
 *
 * It gives up room to whatever is docked against an edge, which is the whole
 * difference between a docked panel and one that merely covers the work. Panels
 * that float or sit in a corner take no space and overlay instead.
 */
function Workspace() {
  const mode = usePlan((s) => s.mode);
  const insets = usePanelInsets();
  return (
    <main
      className="min-w-0 flex-1 transition-[margin] duration-150 ease-out"
      style={{
        marginLeft: insets.left,
        marginRight: insets.right,
        marginTop: insets.top,
        marginBottom: insets.bottom,
      }}
    >
      {mode === "board" ? <Board /> : mode === "tree" ? <Tree /> : <Projects />}
    </main>
  );
}

function Shell() {
  const mode = usePlan((s) => s.mode);
  const picking = usePlan((s) => s.picking);
  return (
    <DndRoot>
      <div className="flex h-full min-w-[1024px] flex-col">
        <Header />
        {picking && mode !== "projects" && <WishlistBar />}
        {/* Everything inside PanelHost is positioned against the workspace, not
            the viewport — "dock top" means under the header, never over it. */}
        <PanelHost>
          <Workspace />
          {mode !== "projects" && <RequirementsRail />}
          <CourseDetail />
          <CoursePicker />
          <Toast />
        </PanelHost>
        {mode !== "projects" && <SemesterRail />}
      </div>
    </DndRoot>
  );
}

export default function App() {
  /**
   * The walkthrough decides once, on mount, whether this is a first run.
   *
   * Deliberately not a live subscription: the first thing it asks you to do is
   * pick a major, and re-evaluating "are you a new student?" after that would
   * close the walkthrough out from under the person still using it.
   */
  const enrolledIds = useProfile((s) => s.enrolledIds);
  const placements = usePlan((s) => s.placements);
  const [welcoming, setWelcoming] = useState(() =>
    shouldWelcome(enrolledIds.length, placements.length),
  );

  return (
    <ModelProvider>
      <Shell />
      {welcoming && <Welcome onClose={() => setWelcoming(false)} />}
    </ModelProvider>
  );
}
