// Copyright 2017 Yoav Seginer, Theo Vosse, Gil Harari, and Uri Kolodny.
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/// <reference path="../../scripts/feg/include/feg/cdl.d.ts" />

/// Note: these are denormalized values

type CDLGeometryPointShape = {Point: {lat: number; lng: number;}};
type CDLGeometryLineShape = {Line: CDLGeometryPointShape[]|CDLGeometryPointShape};
type CDLGeometryLinearRingShape = {LinearRing: CDLGeometryPointShape[]|CDLGeometryPointShape};
type CDLGeometryPolygonShape = {Polygon: CDLGeometryLinearRingShape[]|CDLGeometryLinearRingShape};

interface CDLGeometryPoint {
    type: "Point";
    coordinates: CDLGeometryPointShape;
}

interface CDLGeometryLine {
    type: "Line";
    coordinates: CDLGeometryPointShape[]|CDLGeometryPointShape;
}

interface CDLGeometryLinearRing {
    type: "LinearRing";
    coordinates: CDLGeometryPointShape[]|CDLGeometryPointShape;
}

interface CDLGeometryPolygon {
    type: "Polygon";
    coordinates: CDLGeometryLinearRingShape[]|CDLGeometryLinearRingShape;
}

interface CDLGeometryMultiLine {
    type: "MultiLine";
    coordinates: CDLGeometryLineShape[]|CDLGeometryLineShape;
}

interface CDLGeometryMultiPolygon {
    type: "MultiPolygon";
    coordinates: CDLGeometryPolygonShape[]|CDLGeometryPolygonShape;
}

type CDLGeometryDescription = CDLGeometryPolygon | CDLGeometryMultiPolygon |
                              CDLGeometryLinearRing | CDLGeometryMultiLine |
                              CDLGeometryLine | CDLGeometryPoint;

type CDLGeoRect = {
    north: [number];
    west: [number];
    south: [number];
    east: [number];
};

interface CDLGeometry {
    type: string; // should be "Feature"
    properties?: any;
    geometry: CDLGeometryDescription; // length 1
    bbox?: CDLGeoRect;
}
