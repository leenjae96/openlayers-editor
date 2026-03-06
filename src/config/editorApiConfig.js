// [수정 포인트] 백엔드 API/테이블 설정값은 .env 기반으로 주입.
export const editorApiConfig = {
    baseUrl: import.meta.env.VITE_EDITOR_API_BASE_URL || '/api',
    linkTable: import.meta.env.VITE_EDITOR_LINK_TABLE || 'TB_LINK',
    vertexTable: import.meta.env.VITE_EDITOR_VERTEX_TABLE || 'TB_VERTEX',
    dbVendor: import.meta.env.VITE_EDITOR_DB_VENDOR || 'oracle'
};
