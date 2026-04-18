/**
 * Run Command Feature - Render de comandos executados
 */

import { getBridge } from '../../../../shared/webview/bridge';
import { getStore } from '../../state/store';

export interface RunCommandServices {
  bridge: ReturnType<typeof getBridge>;
  store: ReturnType<typeof getStore>;
}

export function initRunCommand(services: RunCommandServices) {
  // TODO: implementar (pode ser parte do toolCards)
  return {
    destroy: () => {}
  };
}
