/**
 * Store simples para estado do chat
 */

export interface ChatState {
  selectedChatId: string | null;
  messagesByChat: Map<string, any[]>;
  isStreaming: boolean;
  modelSelected: string | null;
  attachmentsDraft: any[];
  allModels: any[];
  selectedModelInfo: any | null;
  currentUsedTokens: number;
  currentChatApiCostUsd: number;
  currentChatApiCostFormatted: string;
  currentChatApiCostTooltip: string;
  currentModelSupportsVision: boolean;
  currentModelName: string;
  currentReasoningEffort: string;
  isFocusedMode: boolean;
  showReasoningButton: boolean;
  showApiCost: boolean;
  showSummarizeButton: boolean;
  showTokenCounter: boolean;
  isModelSelectorOpen: boolean;
  editApprovalMode: 'apply_everything' | 'ask_before_apply';
  editedFiles: Map<string, any>;
  pendingEditMsgId: string | null;
  pendingEditText: string | null;
  queuedMessage: { text: string; attachments: any[]; msgId: string } | null;
  userIsScrolling: boolean;
  isAuthenticated?: boolean;
  isTrialExpired?: boolean;
  authStatus?: any;
}

type StateListener = (state: ChatState) => void;

class ChatStore {
  private state: ChatState = {
    selectedChatId: null,
    messagesByChat: new Map(),
    isStreaming: false,
    modelSelected: null,
    attachmentsDraft: [],
    allModels: [],
    selectedModelInfo: null,
    currentUsedTokens: 0,
    currentChatApiCostUsd: 0,
    currentChatApiCostFormatted: '$0.00',
    currentChatApiCostTooltip: 'Custo estimado de API deste chat',
    currentModelSupportsVision: true,
    currentModelName: '',
    currentReasoningEffort: 'medium',
    isFocusedMode: false,
    showReasoningButton: true,
    showApiCost: true,
    showSummarizeButton: true,
    showTokenCounter: true,
    isModelSelectorOpen: false,
    editApprovalMode: 'apply_everything',
    editedFiles: new Map(),
    pendingEditMsgId: null,
    pendingEditText: null,
    queuedMessage: null,
    userIsScrolling: false,
    isAuthenticated: false,
    isTrialExpired: false,
    authStatus: null,
  };

  private listeners: StateListener[] = [];

  getState(): ChatState {
    return { ...this.state };
  }

  setState(updates: Partial<ChatState>): void {
    this.state = { ...this.state, ...updates };
    this.notifyListeners();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.getState());
      } catch (error) {
        console.error('[Store] Error in listener:', error);
      }
    });
  }
}

let storeInstance: ChatStore | null = null;

export function getStore(): ChatStore {
  if (!storeInstance) {
    storeInstance = new ChatStore();
  }
  return storeInstance;
}
