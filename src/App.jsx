import React, {useEffect, useRef, useState} from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import {Tile as TileLayer, Vector as VectorLayer} from 'ol/layer';
import {OSM, Vector as VectorSource} from 'ol/source';
import {Modify, Select} from 'ol/interaction';
import {click, pointerMove} from 'ol/events/condition';
import Feature from 'ol/Feature';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style';
import {defaults as defaultControls} from 'ol/control';
import {fetchLines, makeSavePayload, saveLineVertices} from './api/lineApi';

import './App.css';

function App() {
    const [features, setFeatures] = useState([]);
    const [selectedFeatureId, setSelectedFeatureId] = useState(null);
    const [hoveredFeatureId, setHoveredFeatureId] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [nodes, setNodes] = useState([]);
    const [highlightedNodeIndex, setHighlightedNodeIndex] = useState(null);
    const [isAddVertexMode, setIsAddVertexMode] = useState(false);

    const mapElement = useRef(null);
    const mapRef = useRef(null);
    const sourceRef = useRef(null);
    const lineLayerRef = useRef(null);
    const highlightSourceRef = useRef(null);
    const selectInteractionRef = useRef(null);
    const modifyInteractionRef = useRef(null);
    const backupGeometryRef = useRef(null);
    const selectedFeatureIdRef = useRef(null);
    const hoveredFeatureIdRef = useRef(null);
    const isAddVertexModeRef = useRef(false);

    // [수정 포인트] 선택/호버 상태에 따라 라인 스타일을 다르게 렌더링.
    const lineStyleFunction = (feature) => {
        const featureId = feature.getId();
        const isSelected = selectedFeatureIdRef.current === featureId;
        const isHovered = hoveredFeatureIdRef.current === featureId;

        const strokeColor = isSelected ? '#f03e3e' : isHovered ? '#22b8cf' : '#0055ff';
        const strokeWidth = isSelected ? 6 : isHovered ? 5 : 4;
        const vertexStroke = isSelected ? '#f03e3e' : '#0055ff';

        const geometry = feature.getGeometry();
        const styles = [
            new Style({
                stroke: new Stroke({color: strokeColor, width: strokeWidth})
            })
        ];

        geometry.getCoordinates().forEach((coord) => {
            styles.push(new Style({
                geometry: new Point(coord),
                image: new CircleStyle({
                    radius: isSelected ? 6 : 5,
                    fill: new Fill({color: 'white'}),
                    stroke: new Stroke({color: vertexStroke, width: 2})
                })
            }));
        });

        return styles;
    };

    useEffect(() => {
        if (!mapElement.current || mapRef.current) return;

        const vectorSource = new VectorSource();
        sourceRef.current = vectorSource;

        const highlightSource = new VectorSource();
        highlightSourceRef.current = highlightSource;

        const lineLayer = new VectorLayer({
            source: vectorSource,
            style: lineStyleFunction
        });
        lineLayerRef.current = lineLayer;

        const map = new Map({
            target: mapElement.current,
            controls: defaultControls({attribution: false, zoom: false}),
            layers: [
                new TileLayer({source: new OSM()}),
                lineLayer,
                new VectorLayer({
                    source: highlightSource,
                    style: new Style({
                        image: new CircleStyle({
                            radius: 8,
                            fill: new Fill({color: 'red'}),
                            stroke: new Stroke({color: 'white', width: 2})
                        }),
                        zIndex: 999
                    })
                })
            ],
            view: new View({
                projection: 'EPSG:4326',
                center: [127.024612, 37.5326],
                zoom: 12
            })
        });
        mapRef.current = map;

        const hoverSelect = new Select({
            condition: pointerMove,
            style: null,
            layers: [lineLayer],
            hitTolerance: 10
        });
        map.addInteraction(hoverSelect);

        const select = new Select({
            condition: (e) => click(e) && !e.originalEvent.ctrlKey && !e.originalEvent.altKey,
            style: null,
            layers: [lineLayer],
            hitTolerance: 10
        });
        selectInteractionRef.current = select;
        map.addInteraction(select);

        const modify = new Modify({
            features: select.getFeatures(),
            pixelTolerance: 10,
            deleteCondition: (e) => click(e) && (e.originalEvent.ctrlKey || e.originalEvent.altKey)
        });
        modify.setActive(false);
        modifyInteractionRef.current = modify;
        map.addInteraction(modify);

        // [수정 포인트] 라인 근접 hover 반응 + 커서 반영.
        hoverSelect.on('select', (e) => {
            const hovered = e.selected[0] || null;
            hoveredFeatureIdRef.current = hovered?.getId() || null;
            setHoveredFeatureId(hovered?.getId() || null);
            lineLayer.changed();
        });

        map.on('pointermove', (e) => {
            if (e.dragging) return;
            const pixel = map.getEventPixel(e.originalEvent);
            const hit = map.hasFeatureAtPixel(pixel, {hitTolerance: 10, layerFilter: (layer) => layer === lineLayer});
            map.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });

        // [수정 포인트] 지도에서 선택한 라인과 목록 선택 상태를 완전히 동기화.
        select.on('select', (e) => {
            const selected = e.selected[0];
            if (selected) {
                const id = selected.getId();
                selectedFeatureIdRef.current = id;
                setSelectedFeatureId(id);
                enterEditMode(selected);
            }
        });

        modify.on('modifyend', () => {
            if (!selectedFeatureIdRef.current || !sourceRef.current) return;
            const feature = sourceRef.current.getFeatureById(selectedFeatureIdRef.current);
            if (feature) {
                updateNodeList(feature);
            }
        });

        // [수정 포인트] 정점 추가 모드일 때 클릭 좌표를 최근접 세그먼트에 삽입.
        map.on('click', (e) => {
            if (!isAddVertexModeRef.current) return;
            if (!selectedFeatureIdRef.current || !sourceRef.current) return;
            insertVertexToClosestSegment(e.coordinate);
        });

        // [수정 포인트] 백엔드 조회 API에서 라인/정점 데이터 로딩 (실패 시 더미 fallback은 lineApi 내부 처리).
        loadLines(vectorSource);

        return () => {
            map.setTarget(null);
            mapRef.current = null;
        };
    }, []);

    useEffect(() => {
        selectedFeatureIdRef.current = selectedFeatureId;
        lineLayerRef.current?.changed();
    }, [selectedFeatureId]);

    useEffect(() => {
        hoveredFeatureIdRef.current = hoveredFeatureId;
        lineLayerRef.current?.changed();
    }, [hoveredFeatureId]);

    useEffect(() => {
        isAddVertexModeRef.current = isAddVertexMode;
    }, [isAddVertexMode]);

    const addLineFeature = (source, id, name, coords) => {
        const feature = new Feature({
            geometry: new LineString(coords),
            name
        });
        feature.setId(id);
        source.addFeature(feature);
    };

    const loadLines = async (source) => {
        const lineDtos = await fetchLines();
        source.clear();
        lineDtos.forEach((lineDto) => {
            addLineFeature(source, lineDto.lineId, lineDto.lineName, lineDto.coordinates);
        });
        updateFeatureList();
    };

    const updateFeatureList = () => {
        if (!sourceRef.current) return;
        const allFeatures = sourceRef.current.getFeatures();
        setFeatures(allFeatures.map((f) => ({id: f.getId(), name: f.get('name')})));
    };

    const updateNodeList = (feature) => {
        const coords = feature?.getGeometry()?.getCoordinates?.() || [];
        setNodes(coords.map((coord, idx) => ({id: idx, coord})));
    };

    const enterEditMode = (feature) => {
        setIsEditing(true);
        setIsAddVertexMode(false);
        modifyInteractionRef.current?.setActive(true);
        backupGeometryRef.current = feature.getGeometry().clone();
        updateNodeList(feature);
        setHighlightedNodeIndex(null);

        // [수정 포인트] 라인 선택 시 해당 extent로 자동 줌.
        mapRef.current?.getView().fit(feature.getGeometry(), {
            padding: [50, 50, 50, 50],
            duration: 400,
            maxZoom: 18
        });
    };

    const insertVertexToClosestSegment = (clickCoord) => {
        const feature = sourceRef.current?.getFeatureById(selectedFeatureIdRef.current);
        if (!feature) return;

        const coords = [...feature.getGeometry().getCoordinates()];
        if (coords.length < 2) return;

        let bestIndex = 0;
        let bestDist = Infinity;

        for (let i = 0; i < coords.length - 1; i += 1) {
            const dist = distanceToSegment(clickCoord, coords[i], coords[i + 1]);
            if (dist < bestDist) {
                bestDist = dist;
                bestIndex = i;
            }
        }

        coords.splice(bestIndex + 1, 0, clickCoord);
        feature.setGeometry(new LineString(coords));
        updateNodeList(feature);
        setHighlightedNodeIndex(bestIndex + 1);
        highlightNodeOnMap(clickCoord);
    };

    const distanceToSegment = (point, start, end) => {
        const [px, py] = point;
        const [x1, y1] = start;
        const [x2, y2] = end;

        const dx = x2 - x1;
        const dy = y2 - y1;
        if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);

        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;
        return Math.hypot(px - projX, py - projY);
    };

    const handleNodeClick = (index, coord) => {
        setHighlightedNodeIndex(index);
        highlightNodeOnMap(coord);
        mapRef.current?.getView().animate({center: coord, duration: 300});
    };

    const highlightNodeOnMap = (coord) => {
        const source = highlightSourceRef.current;
        source?.clear();
        if (coord) source?.addFeature(new Feature(new Point(coord)));
    };

    const exitEditMode = () => {
        setIsEditing(false);
        setIsAddVertexMode(false);
        setSelectedFeatureId(null);
        selectedFeatureIdRef.current = null;
        setNodes([]);
        setHighlightedNodeIndex(null);
        backupGeometryRef.current = null;
        highlightSourceRef.current?.clear();
        modifyInteractionRef.current?.setActive(false);
        selectInteractionRef.current?.getFeatures().clear();
    };

    const handleSave = async () => {
        if (!selectedFeatureIdRef.current || !sourceRef.current) return;

        const feature = sourceRef.current.getFeatureById(selectedFeatureIdRef.current);
        if (!feature) return;

        const payload = makeSavePayload({
            featureId: selectedFeatureIdRef.current,
            lineName: feature.get('name'),
            coordinates: feature.getGeometry().getCoordinates()
        });

        // [수정 포인트] 저장 버튼 클릭 시 변경된 정점 순서/좌표를 API로 전송.
        try {
            await saveLineVertices(payload);
            setIsAddVertexMode(false);
            modifyInteractionRef.current?.setActive(false);
            updateFeatureList();
            backupGeometryRef.current = feature.getGeometry().clone();
            console.log('저장 완료', payload);
        } catch (error) {
            console.error(error);
            alert('저장 실패: API 연결 및 DB 설정을 확인해주세요.');
        }
    };

    const handleCancel = () => {
        if (selectedFeatureIdRef.current && backupGeometryRef.current && sourceRef.current) {
            const feature = sourceRef.current.getFeatureById(selectedFeatureIdRef.current);
            if (feature) feature.setGeometry(backupGeometryRef.current.clone());
        }
        exitEditMode();
    };

    const handleListClick = (id) => {
        const feature = sourceRef.current?.getFeatureById(id);
        if (!feature) return;

        selectInteractionRef.current?.getFeatures().clear();
        selectInteractionRef.current?.getFeatures().push(feature);
        selectedFeatureIdRef.current = id;
        setSelectedFeatureId(id);
        enterEditMode(feature);
    };

    return (
        <div className="container">
            <div className="sidebar">
                <div className="sidebar-header">Lines</div>
                <ul className="vertex-list">
                    {features.map((item) => (
                        <li
                            key={item.id}
                            className={`vertex-item ${selectedFeatureId === item.id ? 'selected' : ''}`}
                            onClick={() => handleListClick(item.id)}
                        >
                            {item.name}
                        </li>
                    ))}
                </ul>
            </div>

            <div className="map-wrapper">
                {isEditing && (
                    <div className="control-panel">
                        <span style={{fontSize: '0.9rem', alignSelf: 'center'}}>
                            Editing: <strong>{features.find((f) => f.id === selectedFeatureId)?.name}</strong>
                        </span>
                        {/* [수정 포인트] 정점 추가 모드 토글 버튼 */}
                        <button onClick={() => setIsAddVertexMode((prev) => !prev)} style={{cursor: 'pointer'}}>
                            {isAddVertexMode ? '정점 추가 종료' : '정점 추가'}
                        </button>
                        <button onClick={handleSave} style={{cursor: 'pointer'}}>Save</button>
                        <button onClick={handleCancel} style={{cursor: 'pointer'}}>Cancel</button>
                    </div>
                )}
                <div id="map" ref={mapElement}/>
            </div>

            {isEditing && (
                <div className="node-sidebar">
                    <div className="node-header">
                        Vertices ({nodes.length} points)<br/>
                        <span style={{fontSize: '0.7rem', color: '#ddd'}}>드래그 이동 / Ctrl(or Alt)+클릭 삭제 / 추가모드에서 클릭 추가</span>
                    </div>
                    <ul className="node-list">
                        {nodes.map((node, index) => (
                            <li
                                key={node.id}
                                className={`node-item ${highlightedNodeIndex === index ? 'highlight' : ''}`}
                                onClick={() => handleNodeClick(index, node.coord)}
                            >
                                <span>#{index + 1}</span>
                                <span>{node.coord ? `${node.coord[0].toFixed(5)}, ${node.coord[1].toFixed(5)}` : ''}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export default App;
