export interface SessionOperation {
    type: 'create' | 'switch';
    fileId: string;
    fileName: string;
    isProcessed: boolean;
}

class SessionStateManager {
    private static instance: SessionStateManager;
    private pendingOperations: Map<string, SessionOperation> = new Map();
    private executingOperations: Set<string> = new Set();

    private constructor() {}

    static getInstance() {
        if (!this.instance) {
            this.instance = new SessionStateManager();
        }
        return this.instance;
    }

    registerOperation(operation: SessionOperation) {
        this.pendingOperations.set(operation.fileId, {
            ...operation,
            isProcessed: false
        });
    }

    getOperation(fileId: string): SessionOperation | undefined {
        return this.pendingOperations.get(fileId);
    }

    markAsProcessed(fileId: string) {
        const operation = this.pendingOperations.get(fileId);
        if (operation) {
            operation.isProcessed = true;
        }
    }

    clearOperation(fileId: string) {
        this.pendingOperations.delete(fileId);
    }

    isExecuting(fileId: string): boolean {
        return this.executingOperations.has(fileId);
    }

    setExecuting(fileId: string) {
        this.executingOperations.add(fileId);
    }

    clearExecuting(fileId: string) {
        this.executingOperations.delete(fileId);
    }

}

export const sessionManager = SessionStateManager.getInstance();