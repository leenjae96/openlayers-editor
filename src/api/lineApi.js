import {editorApiConfig} from '../config/editorApiConfig';
import {dummyLines} from './mockData';

const toFeatureDto = (line) => ({
    lineId: line.lineId,
    lineName: line.lineName,
    coordinates: [...line.vertices]
        .sort((a, b) => a.seqNo - b.seqNo)
        .map((v) => [v.lon, v.lat])
});

// [수정 포인트] line + vertex 조회 API(실패 시 더미 fallback).
export const fetchLines = async () => {
    try {
        const response = await fetch(`${editorApiConfig.baseUrl}/lines`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data.map(toFeatureDto);
    } catch (error) {
        console.warn('라인 조회 API 실패 - 더미 데이터 사용', error);
        return dummyLines.map(toFeatureDto);
    }
};

// [수정 포인트] 저장 payload 생성기 (변경점 저장 API에서 재사용).
export const makeSavePayload = ({featureId, lineName, coordinates}) => ({
    lineId: featureId,
    lineName,
    linkTable: editorApiConfig.linkTable,
    vertexTable: editorApiConfig.vertexTable,
    dbVendor: editorApiConfig.dbVendor,
    vertices: coordinates.map((coord, index) => ({
        seqNo: index + 1,
        lon: coord[0],
        lat: coord[1]
    }))
});

// [수정 포인트] line + vertex 저장 API 틀.
export const saveLineVertices = async (payload) => {
    const response = await fetch(`${editorApiConfig.baseUrl}/lines/${payload.lineId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`저장 실패: HTTP ${response.status}`);
    }

    return response.json().catch(() => ({success: true}));
};
