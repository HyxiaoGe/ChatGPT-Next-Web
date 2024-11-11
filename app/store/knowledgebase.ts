import {CHATCHAT} from "@/app/constant";


export interface KnowledgeBase {
    id: string;
    kb_name: string;
    kb_info: string;
    vs_type: string;
    embed_model: string;
    createdAt: number;
    create_time: string;
}

export class KnowledgeBaseCache {
    static async fetch(): Promise<KnowledgeBase> {
        try {
            const path = CHATCHAT.KnowledgeBaseListPath

            const response = await fetch(path)
            const result: KnowledgeBase = await response.json()
            if (result) {
                return result
            }
            throw new Error("Failed to fetch knowledge base list")
        } catch (error) {
            console.error("Failed to fetch knowledge base list:", error);
            throw error;
        }

    }

}