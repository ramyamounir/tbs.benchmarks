import { AppLayout } from './components/AppLayout';
import { useReady } from './state/selectors';
import { useAppStore } from './state/store';
import { ChartsView } from './views/charts/ChartsView';
import { ConfigView } from './views/config/ConfigView';
import { OverviewView } from './views/overview/OverviewView';
import { StartView } from './views/StartView';
import { TableView } from './views/table/TableView';
import { WritebackView } from './views/writeback/WritebackView';

/** The main area renders by `ui.view`; Overview shows the Start screen until ready. */
function MainView() {
  const view = useAppStore((s) => s.ui.view);
  const ready = useReady();
  switch (view) {
    case 'overview':
      return ready ? <OverviewView /> : <StartView />;
    case 'table':
      return <TableView />;
    case 'charts':
      return <ChartsView />;
    case 'config':
      return <ConfigView />;
    case 'writeback':
      return <WritebackView />;
  }
}

export default function App() {
  return (
    <AppLayout>
      <MainView />
    </AppLayout>
  );
}
