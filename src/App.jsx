import React, {useState, useEffect, useRef} from 'react';
import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import {Tile as TileLayer, Vector as VectorLayer} from 'ol/layer';
import {OSM, Vector as VectorSource} from 'ol/source';
import {Select, Modify} from 'ol/interaction';
import {click, pointerMove} from 'ol/events/condition'; // pointerMove 추가
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Feature from 'ol/Feature';
import {Circle as CircleStyle, Fill, Stroke, Style} from 'ol/style';
import {defaults as defaultControls} from 'ol/control';

import './App.css';

function App() {
    const [features, setFeatures] = useState([]);
    const [selectedFeatureId, setSelectedFeatureId] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [nodes, setNodes] = useState([]);
    const [highlightedNodeIndex, setHighlightedNodeIndex] = useState(null);

    const mapElement = useRef(null);
    const mapRef = useRef(null);
    const sourceRef = useRef(null);
    const highlightSourceRef = useRef(null);
    const selectInteractionRef = useRef(null);
    const modifyInteractionRef = useRef(null);
    const backupGeometryRef = useRef(null);

    useEffect(() => {
        if (!mapElement.current || mapRef.current) return;

        const vectorSource = new VectorSource();
        sourceRef.current = vectorSource;

        const highlightSource = new VectorSource();
        highlightSourceRef.current = highlightSource;

        const map = new Map({
            target: mapElement.current,
            controls: defaultControls({
                attribution: false,
                zoom: false
            }),
            layers: [
                new TileLayer({
                    source: new OSM()
                }),
                new VectorLayer({
                    source: vectorSource,
                    style: lineStyleFunction
                }),
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
                center: [127.024612, 37.532600],
                zoom: 12,
            }),
        });
        mapRef.current = map;

        // --- [NEW] 1. Hover Interaction (마우스 오버 시 시각적 효과) ---
        // 클릭은 안 하고 '이거 선택할 거야?'라고 보여주기만 함
        const hoverSelect = new Select({
            condition: pointerMove, // 마우스가 움직일 때 발동
            style: hoverStyleFunction, // 마우스 올렸을 때 적용할 스타일
            layers: [map.getLayers().getArray()[1]], // 데이터 레이어만 대상
            hitTolerance: 10, // [UX 핵심] 10px 근처에만 가도 인식 (자석 효과)
        });
        map.addInteraction(hoverSelect);

        // 마우스 커서 변경 로직 (선 위에 있으면 손가락, 아니면 기본)
        map.on('pointermove', (e) => {
            if (e.dragging) return;
            const pixel = map.getEventPixel(e.originalEvent);
            const hit = map.hasFeatureAtPixel(pixel, {hitTolerance: 10});
            map.getTargetElement().style.cursor = hit ? 'pointer' : '';
        });


        // --- 2. Click Select Interaction (실제 선택 및 편집 진입) ---
        const select = new Select({
            condition: (e) => click(e) && !e.originalEvent.ctrlKey && !e.originalEvent.altKey,
            style: null // 선택되어도 스타일 변경 안 함 (편집 모드 스타일은 따로 없으니)
        });
        selectInteractionRef.current = select;
        map.addInteraction(select);


        // --- 3. Modify Interaction ---
        const modify = new Modify({
            features: select.getFeatures(),
            pixelTolerance: 10,
            deleteCondition: (e) => click(e) && (e.originalEvent.ctrlKey || e.originalEvent.altKey)
        });
        modifyInteractionRef.current = modify;
        modify.setActive(false);
        map.addInteraction(modify);


        // [이벤트] 피처 클릭 선택
        select.on('select', (e) => {
            const selected = e.selected[0];
            if (selected) {
                setSelectedFeatureId(selected.getId());
                enterEditMode(selected);
                // Hover 효과랑 겹치지 않게 Hover 선택은 풀어줌
                hoverSelect.getFeatures().clear();
            } else {
                handleCancel();
            }
        });

        // [이벤트] 하이라이트 (편집 모드일 때만)
        map.on('click', (e) => {
            if (e.originalEvent.ctrlKey || e.originalEvent.altKey) return;
            if (!modify.getActive()) return; // 편집 중 아니면 무시
            findClosestNodeAndUpdate(e.coordinate);
        });

        // [성능 최적화] 점 이동이 "끝났을 때"만 목록 갱신 (modifyend)
        // 리액트 렌더링 부하 최소화
        modify.on('modifyend', (e) => {
            if (selectedFeatureId && sourceRef.current) {
                const feature = sourceRef.current.getFeatureById(selectedFeatureId);
                updateNodeList(feature);
            }
        });


        // 초기 데이터
        addDummyLine(vectorSource, 'Vertex01', [
            [126.90, 37.53], [126.93, 37.52], [126.96, 37.51], [127.00, 37.53]
        ]);
        addDummyLine(vectorSource, 'Vertex02', [
            [127.027, 37.497], [127.024, 37.505], [127.021, 37.513]
        ]);

        updateFeatureList();

        // [피드백 반영] 확실한 Cleanup
        return () => {
            if (mapRef.current) {
                mapRef.current.setTarget(null);
                mapRef.current = null;
            }
        };
    }, []);

    // --- Styles ---

    // 평소 스타일 (파란 선)
    const lineStyleFunction = (feature) => {
        const geometry = feature.getGeometry();
        const styles = [
            new Style({stroke: new Stroke({color: '#0055ff', width: 4})})
        ];
        geometry.getCoordinates().forEach((coord) => {
            styles.push(new Style({
                geometry: new Point(coord),
                image: new CircleStyle({
                    radius: 5,
                    fill: new Fill({color: 'white'}),
                    stroke: new Stroke({color: '#0055ff', width: 2})
                })
            }));
        });
        return styles;
    };

    // [NEW] 마우스 올렸을 때 스타일 (두꺼운 하늘색 + 투명도)
    const hoverStyleFunction = (feature) => {
        return new Style({
            stroke: new Stroke({
                color: 'rgba(0, 200, 255, 0.7)', // 반투명 하늘색
                width: 10 // 두껍게 해서 "나 여기 있어!" 강조
            }),
            zIndex: 1 // 다른 선보다 위에 그림
        });
    };


    // --- Helper Functions ---
    const addDummyLine = (source, name, coords) => {
        const feature = new Feature({
            geometry: new LineString(coords),
            name: name,
        });
        feature.setId(String(Date.now() + Math.random()));
        source.addFeature(feature);
    };

    const updateFeatureList = () => {
        if (!sourceRef.current) return;
        const allFeatures = sourceRef.current.getFeatures();
        const list = allFeatures.map(f => ({
            id: f.getId(),
            name: f.get('name'),
        }));
        setFeatures(list);
    };

    const updateNodeList = (feature) => {
        if (!feature) return;
        const geometry = feature.getGeometry();
        if (!geometry || !geometry.getCoordinates) return;
        const coords = geometry.getCoordinates();
        setNodes(coords.map((c, idx) => ({id: idx, coord: c})));
    };

    const enterEditMode = (feature) => {
        setIsEditing(true);
        modifyInteractionRef.current.setActive(true);
        backupGeometryRef.current = feature.getGeometry().clone();

        updateNodeList(feature);
        setHighlightedNodeIndex(null);

        // [성능 최적화] 실시간 'change' 리스너 삭제함.
        // 대신 점 추가/삭제(구조변경) 감지만 필요하다면 change 이벤트를 쓰되,
        // 단순 드래그는 modifyend에서 처리.
        // *단, 점 '추가'나 '삭제'는 modifyend에서 안 잡힐 수 있어서
        // 구조 변경 감지용으로는 change를 쓰되 쓰로틀링(Throttling)을 걸거나 해야 함.
        // 이번 요구사항(부하 줄이기)에 맞춰 일단 modifyend 위주로 처리.

        mapRef.current.getView().fit(feature.getGeometry(), {padding: [50, 50, 50, 50], duration: 500});
    };

    const findClosestNodeAndUpdate = (clickCoord) => {
        if (!selectedFeatureId || !sourceRef.current) return;
        const feature = sourceRef.current.getFeatureById(selectedFeatureId);
        if (!feature) return;
        const coords = feature.getGeometry().getCoordinates();
        let closestIdx = -1;
        let minDist = Infinity;
        coords.forEach((c, idx) => {
            const dx = c[0] - clickCoord[0];
            const dy = c[1] - clickCoord[1];
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < minDist) {
                minDist = dist;
                closestIdx = idx;
            }
        });
        if (closestIdx !== -1 && minDist < 0.005) {
            setHighlightedNodeIndex(closestIdx);
            highlightNodeOnMap(coords[closestIdx]);
        } else {
            setHighlightedNodeIndex(null);
            highlightSourceRef.current.clear();
        }
    };

    const handleNodeClick = (index, coord) => {
        setHighlightedNodeIndex(index);
        highlightNodeOnMap(coord);
        mapRef.current.getView().animate({center: coord, duration: 300});
    };

    const highlightNodeOnMap = (coord) => {
        const source = highlightSourceRef.current;
        source.clear();
        source.addFeature(new Feature(new Point(coord)));
    };

    const handleSave = () => {
        exitEditMode();
        updateFeatureList();
        console.log("저장 완료!");
    };

    const handleCancel = () => {
        if (selectedFeatureId && backupGeometryRef.current && sourceRef.current) {
            const feature = sourceRef.current.getFeatureById(selectedFeatureId);
            if (feature) {
                feature.setGeometry(backupGeometryRef.current);
            }
        }
        exitEditMode();
    };

    const exitEditMode = () => {
        setIsEditing(false);
        setSelectedFeatureId(null);
        backupGeometryRef.current = null;
        setNodes([]);
        highlightSourceRef.current.clear();

        if (modifyInteractionRef.current) modifyInteractionRef.current.setActive(false);
        if (selectInteractionRef.current) selectInteractionRef.current.getFeatures().clear();
    };

    const handleListClick = (id) => {
        if (isEditing) {
            alert("저장/취소 먼저 해주세요");
            return;
        }
        const feature = sourceRef.current.getFeatureById(id);
        if (feature) {
            selectInteractionRef.current.getFeatures().clear();
            selectInteractionRef.current.getFeatures().push(feature);
            setSelectedFeatureId(id);
            enterEditMode(feature);
        }
    };

    return (
        <div className="container">
            <div className="sidebar">
                <div className="sidebar-header">Lines (Features)</div>
                <ul className="vertex-list">
                    {features.map((item) => (
                        <li key={item.id} className={`vertex-item ${selectedFeatureId === item.id ? 'selected' : ''}`}
                            onClick={() => handleListClick(item.id)}>
                            {item.name}
                        </li>
                    ))}
                </ul>
            </div>

            <div className="map-wrapper">
                {isEditing && (
                    <div className="control-panel">
            <span style={{fontSize: '0.9rem', alignSelf: 'center'}}>
                Editing: <strong>{features.find(f => f.id === selectedFeatureId)?.name}</strong>
            </span>
                        <button onClick={handleSave} style={{cursor: 'pointer'}}>Save</button>
                        <button onClick={handleCancel} style={{cursor: 'pointer'}}>Cancel</button>
                    </div>
                )}
                <div id="map" ref={mapElement}></div>
            </div>

            {isEditing && (
                <div className="node-sidebar">
                    <div className="node-header">
                        Vertices ({nodes.length} points)<br/>
                        <span style={{fontSize: '0.7rem', color: '#aaa'}}>Ctrl+Click on vertex to delete</span>
                    </div>
                    <ul className="node-list">
                        {nodes.map((node, index) => (
                            <li key={index}
                                className={`node-item ${highlightedNodeIndex === index ? 'highlight' : ''}`}
                                onClick={() => handleNodeClick(index, node.coord)}>
                                <span>#{index + 1}</span>
                                <span>
                            {node.coord?.[0] ? `${node.coord[0].toFixed(4)}, ${node.coord[1].toFixed(4)}` : ''}
                        </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}

export default App;