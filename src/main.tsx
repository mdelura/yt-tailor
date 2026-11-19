import { render } from 'preact';
import { App } from './app';
import { renewOnLoad } from './auth';
import { IS_DEMO } from './demo';
import './ui/styles.css';

// An expired sign-in is renewed by a quick round trip to Google before anything renders.
if (IS_DEMO || !renewOnLoad()) render(<App />, document.getElementById('app')!);
