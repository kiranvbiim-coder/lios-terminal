import {Composition} from "remotion";
import {DemoVideo, DEMO_DURATION_IN_FRAMES, DEMO_FPS, DEMO_HEIGHT, DEMO_WIDTH} from "./DemoVideo";

export const RemotionRoot = () => {
  return (
    <Composition
      id="BLMTRMTerminalDemo"
      component={DemoVideo}
      durationInFrames={DEMO_DURATION_IN_FRAMES}
      fps={DEMO_FPS}
      width={DEMO_WIDTH}
      height={DEMO_HEIGHT}
    />
  );
};
