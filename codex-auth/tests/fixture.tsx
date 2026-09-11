import { createRoot } from 'react-dom/client';
import { AuthPanel } from '../src/AuthPanel';
import css from '../src/style.css';
const style = document.createElement('style'); style.textContent = css; document.head.append(style);
createRoot(document.getElementById('app')!).render(<AuthPanel />);
