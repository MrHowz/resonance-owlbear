import { createBridge } from './platform/bridge';
import { RoomService } from './platform/service';
void createBridge()
  .then(async (bridge) => {
    const service = new RoomService(bridge);
    await service.start();
    window.addEventListener(
      'pagehide',
      () => {
        service.destroy();
        bridge.destroy();
      },
      { once: true },
    );
  })
  .catch((e) => console.error('Resonance audio service could not start', e));
