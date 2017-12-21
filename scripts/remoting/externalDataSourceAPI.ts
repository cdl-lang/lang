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

/// <reference path="../feg/externalTypes.basic.d.ts" />

interface ExternalDataSourceSpecification {
	name: string; // the name under which the data source will be shown to the user
	id: string; // shouldn't overlap with the existing mongo ids; anything that's not 24 hexdigits is fine
	revision?: number;
	type: string; // type of data source, e.g. "redshift", "mariadb", "mysql" or "mongodb"
	hostname: string;
	portNumber: number; // only if not the default
	database?: string;
	credentials?: {
        username: string;
        password: string;
	};
	// defines the data; contains parameters, e.g. "SELECT * FROM sales WHERE region = :p1"
	query: string;
	// query parameters; the cdl should provide them as an av mapping id to value,
	// but they're passed along to the external interface as an array in the
	// same order.
	queryParameters?: {
		id: string;
		description: string; // name of the parameter as shown to the user, e.g. "sales region"
		type: string; // one of "integer", "number", "date", "string", "boolean"
		min?: any;
		max?: any;
		discreteValues?: any[];
		optional?: boolean; // when true, this parameter can be missing
		defaultValue?: any; // When there's no value, use this one
    }[];
	attributes: { // Like DataSourceAttributesInfo[] but not normalized
		// Name of the facet/column
		name: string;
		// Original name, in case it was renamed (names cannot start with _ when uploading to mongodb) 
		originalName?: string;
		// information about the type of the data in this column: string, number,
		// integer, or mixed. If no data, it's left undefined
		type?: string;
		// Count of the number of values of each type
		typeCount: {
            number: number;
            string: number;
            object: number;
            undefined: number;
            boolean: number;
            currency: number;
            nrPositive: number;
            nrNegative: number;
            nrUnique: number;
            nrUniqueValuesPerType: {
                number: number;
                string: number;
                object: number;
                boolean: number;
				currency: number;
			};
		};
		// Minimum value found if type is not mixed
		min?: number;
		// Maximum value found if type is not mixed
		max?: number;
		// Os of unique values, but only when in proportion to the size of the
		// data (when there are less than 12 * Math.log(data.length - 1)
		// such values, to be precise).
		uniqueValues?: any[];
		// Symbol of the currency if it was found
		currency?: string;
	}[];
}

interface ReadyInterface {
	setReady(): void;
}

class ExternalDataSource {
	constructor(
		public dataSourceSpec: ExternalDataSourceSpecification,
		public parameterValues: any[],
		public path: string[]
	) {
	}
	
	destroy(): void {
		throw "do not call";
	}

    getData(cb: (err: any, data: any, rev: number) => void): void {
		throw "do not call";
	}
}

var externalDataSourceClasses: {
    classConstructor: typeof ExternalDataSource,
    accepts: (dataSourceSpec: ExternalDataSourceSpecification, path: string[]) => boolean
}[] = [];
