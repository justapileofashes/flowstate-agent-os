import { FLOWSTATE_BODY } from './flowstate-body';

export default function HomePage() {
  // The Flowstate design is a self-contained markup + CSS + vanilla-JS bundle.
  // It ships verbatim via dangerouslySetInnerHTML; the scripts in the layout
  // drive the canvas background, mascots, hardware recommender and interactions.
  return <div dangerouslySetInnerHTML={{ __html: FLOWSTATE_BODY }} />;
}
