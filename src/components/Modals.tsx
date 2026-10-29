import { openPicker } from '../sources/drop';
import { GenerateWizard } from '../views/config/GenerateWizard';
import { useAppStore } from '../state/store';
import { ExportMenu } from './ExportMenu';
import { GithubForm } from './GithubForm';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

const TITLES = {
  generate: 'Generate config from files',
  addRuns: 'Add runs',
  github: 'Load from GitHub',
  export: 'Export',
} as const;

function AddRunsBody() {
  const closeModal = useAppStore((s) => s.closeModal);
  const openModal = useAppStore((s) => s.openModal);
  const pick = (folder: boolean) => {
    closeModal();
    openPicker('run', folder);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">
        Add wandb CSV exports, benchmark tables or a whole folder as runs (up to 6). You can also
        drop files anywhere on the page.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => pick(false)}>
          Choose files…
        </Button>
        <Button onClick={() => pick(true)}>Choose folder…</Button>
        <Button variant="ghost" onClick={() => openModal({ kind: 'github', role: 'run' })}>
          From GitHub…
        </Button>
      </div>
      <p className="text-[11px] text-faint">File type is detected from the header</p>
    </div>
  );
}

/**
 * Renders `ui.modal`: the Add runs pickers and the GitHub form (Phase 3), the Generate wizard
 * (Phase 4b) and the Export menu (Phase 6).
 */
export function Modals() {
  const modal = useAppStore((s) => s.ui.modal);
  const closeModal = useAppStore((s) => s.closeModal);
  if (modal === null) return null;
  // The wizard renders its own Modal (920 px, per-step footer).
  if (modal.kind === 'generate') return <GenerateWizard step={modal.step} />;
  let body;
  switch (modal.kind) {
    case 'addRuns':
      body = <AddRunsBody />;
      break;
    case 'github':
      body = <GithubForm role={modal.role} onStarted={closeModal} />;
      break;
    case 'export':
      body = <ExportMenu />;
      break;
  }
  const title =
    modal.kind === 'github'
      ? modal.role === 'baseline'
        ? 'Baseline from GitHub'
        : 'Run from GitHub'
      : TITLES[modal.kind];
  return (
    <Modal
      title={title}
      onClose={closeModal}
      footer={
        <Button variant="secondary" onClick={closeModal}>
          Close
        </Button>
      }
    >
      {body}
    </Modal>
  );
}
