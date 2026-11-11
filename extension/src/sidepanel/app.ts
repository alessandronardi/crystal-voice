import { mountPage } from '../ui/mount-page.ts';
import { mountCaptureView } from './capture-view.ts';

mountPage('sidepanel');
const root = document.getElementById('app');
if (root !== null) mountCaptureView(root);
