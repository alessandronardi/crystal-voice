import { mountPage } from '../ui/mount-page.ts';
import { mountShell } from './shell.ts';

mountPage('sidepanel');
const root = document.getElementById('app');
// I-13a: the screens of SPEC §13; the capture and file views live inside them.
if (root !== null) mountShell(root);
