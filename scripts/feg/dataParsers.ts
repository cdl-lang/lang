// Copyright 2018 Yoav Seginer, Theo Vosse.
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

// these currently only apply to matrix data, not to JSON xxxxxxxxxxxx
var dataTableMaxNrRows: number = undefined;
var dataTableMaxNrColumns: number = undefined;
var dataTableFacetRestriction: string = undefined;

// This class collects functions which are common to all data parsing
// classes. These include mainly 'local' conversion functions (such as
// number formatting, data and time formatting, etc. which are independent
// of the table data format: csv, json, etc.).

abstract class DataParser
{
    // common regular expressions
    
    // These two regular expressions match anglo and euro number formats, and
    // put the (optional) sign in the first field, the leading digits in the
    // second field, the remaining integer digits in the third field (where it's
    // safe to remove comma or dot), and the optional fractional part in the
    // fifth field (including leading dot/comma).
    static angloNumberFormat = /^([+-])?([0-9][0-9]?[0-9]?)((,[0-9][0-9][0-9])*)(\.[0-9]*)?$/;
    static euroNumberFormat = /^([+-])?([0-9][0-9]?[0-9]?)((\.[0-9][0-9][0-9])*)(,[0-9]*)?$/;
    static dateTest = /^[0-9][0-9]?[\/-][0-9][0-9]?[\/-][0-9][0-9][0-9][0-9]$/;
    static dateSplit = /^([0-9][0-9]?)[\/-]([0-9][0-9]?)[\/-]([0-9][0-9][0-9][0-9])$/;
    
    static currencySymbols = { "¥": 1, "$": 1, "£": 1, "€": 1 };

    dataPerFacet: {[facetName: string]: SimpleValue[]};
    attributes: DataSourceAttributesInfo[];
    columnHeaders: string[];
    nrRows: number;
    
    // true if all data paths are of length 1 (no embedded objects). In this
    // case, the mechanism which loads columns into the indexer as needed
    // can be used. This is always true for matrix data, but not always
    // for JSON data.
    useDataSupplyMechanism: boolean;
    // the path statistics object of paths which may be date paths. 
    protected possibleDate: DataSourceAttributesInfo[];
    protected stringCache: Map<string, string>;
    protected maxExpectedUniqueValues: number;
    
    // currently, there is not much to do here on construction
    
    constructor()
    {
        this.useDataSupplyMechanism = true;
        this.possibleDate = [];
        this.dataPerFacet = {};
        this.attributes = [];
        this.columnHeaders = [];
        this.nrRows = 0;

        this.stringCache = new Map<string, string>();
    }

    // main function to load the data from a string representation
    abstract loadData(): void

    // function to retrieve data in 'object' format, that is, as an
    // array of objects whose attributes are the columns/paths. This is
    // implemented by each derived class separately and may be a costly
    // operation (if the data is not already available in this format).
    abstract getDataAsOSOfAVs(): any[]
    
    //
    // Date and number conversion
    //

    // Given a list of paths which may contain dates, this function determines
    // the date format used (dmy, mdy or ymd). It returns a formatting function
    // which reads in the dates in the given format and returns the date
    // as seconds since 1 Jan 1970 UTC.
    // If several formats are possible, dmy is preferred to mdy which is
    // preferred to ymd.
    // If no format is possible, undefined is returned.

    getDateFormatter(): (matches: RegExpExecArray) => number
    {
        var min1 = Number.MAX_VALUE;
        var min2 = Number.MAX_VALUE;
        var min3 = Number.MAX_VALUE;
        var max1 = 0, max2 = 0, max3 = 0; 
        var fmt: (matches: RegExpExecArray) => number;

        function dmy(matches: RegExpExecArray): number {
            var date: Date = new Date(1, 0);

            date.setDate(Number(matches[1]));
            date.setMonth(Number(matches[2]) - 1);
            date.setFullYear(Number(matches[3]));
            return date.getTime() / 1000;
        }

        function mdy(matches: RegExpExecArray): number {
            var date: Date = new Date(1, 0);
            
            date.setDate(Number(matches[2]));
            date.setMonth(Number(matches[1]) - 1);
            date.setFullYear(Number(matches[3]));
            return date.getTime() / 1000;
        }

        function ymd(matches: RegExpExecArray): number {
            var date: Date = new Date(1, 0);
            
            date.setDate(Number(matches[3]));
            date.setMonth(Number(matches[2]) - 1);
            date.setFullYear(Number(matches[1]));
            return date.getTime() / 1000;
        }

        for (var j = 0; j < this.possibleDate.length; j++) {
            // get the path values
            var attrInfo: DataSourceAttributesInfo = this.possibleDate[j];
            var column: any[] = this.dataPerFacet[attrInfo.name[0]];
            for (var i: number = 0; i < this.nrRows; i++) {
                var value: any = column[i];
                if (typeof(value) === "string") {
                    var matches = DataParser.dateSplit.exec(value);
                    if (matches !== null) {
                        var f1 = Number(matches[1]);
                        var f2 = Number(matches[2]);
                        var f3 = Number(matches[3]);
                        if (f1 > max1) {
                            max1 = f1;
                        }
                        if (f1 < min1) {
                            min1 = f1;
                        }
                        if (f2 > max2) {
                            max2 = f2;
                        }
                        if (f2 < min2) {
                            min2 = f2;
                        }
                        if (f3 > max3) {
                            max3 = f3;
                        }
                        if (f3 < min3) {
                            min3 = f3;
                        }
                    }
                }
            }
        }
        if ((12 < max1 && max1 <= 31 && max2 <= 12 && 1500 <= max3 && max3 <= 2100) ||
            (max1 === min1 && min2 === 1 && max2 === 12 && 1500 <= max3 && max3 <= 2100)) {
            return dmy;
        } else if ((12 < max2 && max2 <= 31 && max1 <= 12 && 1500 <= max3 && max3 <= 2100) ||
                   (max2 === min2 && min1 === 1 && max1 === 12 && 1500 <= max3 && max3 <= 2100)) {
            return mdy;
        } else if ((12 < max3 && max3 <= 31 && max2 <= 12 && 1500 <= max1 && max1 <= 2100) ||
                   (max3 === min3 && min2 === 1 && max2 === 12 && 1500 <= max1 && max1 <= 2100)) {
            return ymd;
        } else
            return undefined;
    }

    // This function converts all dates (which were originally represented
    // as strings) into numeric date values (seconds since 1 Jan 1970 UTC)
    
    convertDates(): void
    {
        var fmt = this.getDateFormatter();
        for (var j = 0; j < this.possibleDate.length; j++) {

            // get the path values
            var attrInfo: DataSourceAttributesInfo = this.possibleDate[j];
            var column: any[] = this.dataPerFacet[attrInfo.name[0]];
            
            var min = Number.MAX_VALUE;
            var max = -Number.MAX_VALUE;
            var typeCount = attrInfo.typeCount[0];
            attrInfo.type = ["date"];
            typeCount.date = typeCount.string;
            typeCount.string = [0];
            typeCount.nrUniqueValuesPerType[0].date =
                typeCount.nrUniqueValuesPerType[0].string;
            typeCount.nrUniqueValuesPerType[0].string = [0];
            for (var i: number = 0; i < this.nrRows; i++) {
                var value: any = column[i];
                if (typeof(value) === "string") {
                    var matches = DataParser.dateSplit.exec(value);
                    var conv = fmt(matches);
                    column[i] = conv;
                    if (conv < min) {
                        min = conv;
                    }
                    if (conv > max) {
                        max = conv;
                    }
                }
            }
            attrInfo.min = [min];
            attrInfo.max = [max];
            if (attrInfo.uniqueValues !== undefined) {
                attrInfo.uniqueValues =
                    attrInfo.uniqueValues.map(
                        (v: any): any =>
                            typeof(v) === "string"?
                            fmt(DataParser.dateSplit.exec(v)): v);
            }
        }
    }
    
    // This function converts a string into a number.
    
    convertNumberFormat(numStr: string): any {
        var matches: string[];

        if ((((matches = DataParser.angloNumberFormat.exec(numStr)) !== null) ||
             ((matches = DataParser.euroNumberFormat.exec(numStr)) !== null))) {
            var convStr: string = matches[1] === undefined? "": matches[1];
            convStr += matches[2];
            if (matches[3] !== undefined) {
                convStr += matches[3].replace(/,/g, "");
            }
            if (matches[5] !== undefined) {
                convStr += "." + matches[5].substr(1);
            }
            return Number(convStr);
        }
        return numStr;
    }

    // this function determines the cell type, converts the value, if needed,
    // and returns the converted value. In addition, it updates the
    // path statistics and the string value cache. The type of the cell
    // is stored on the path statistics object under 'currentCellType'.
    // 'mustBeString' is true if 'value' must be a string representation
    // of the value (and therefore may encode all other value types as
    // strings). If it is false, 'value' may be a string representation
    // of a number, but all other values are expected to have already been
    // converted to values of the appropriate type.
    // This function currently assigns a type of "undefined" to compound
    // values such as A_Vs and arrays (of length other than 1).
    
    getCellValue(value: any, mustBeString: boolean,
                 stats: DataPathStatistics): any
    {
        if ((mustBeString &&
             (value === "NULL" || value === "" || value === "undefined")) ||
            value === undefined || value === null) {
            stats.currentCellType = "undefined";
            return undefined;
        }

        if(!mustBeString && (value instanceof Object)) {
            if((value instanceof Array) && value.length === 1)
                return this.getCellValue(value[0], mustBeString, stats);
            else {
                this.useDataSupplyMechanism = false;
                stats.currentCellType = "undefined";
                return undefined;
            }
        }
        
        var numValue: number = Number(value);
        var currency: string = undefined;
        var cellValue: any; // cell value after conversion: number or string
        
        // Try more costly currency and locale conversions only when
        // the column is not mixed already.
        if(stats.type !== "mixed" && isNaN(numValue)) {
            currency = value.charAt(0);
            if (currency in DataParser.currencySymbols) {
                var numStr: string = value.substr(1);
                numValue = Number(numStr);
                if (isNaN(numValue))
                    numValue = this.convertNumberFormat(numStr);
            } else {
                currency = undefined;
                numValue = this.convertNumberFormat(value);
            }
        }
        
        if (!isNaN(numValue) && numValue !== -Infinity &&
            numValue !== Infinity) {
            value = numValue;
            if (currency === undefined) {
                stats.currentCellType = "number";
                cellValue = numValue;
            } else {
                stats.currentCellType = "currency";
                if (stats.currency === undefined) {
                    stats.currency = currency;
                    cellValue = numValue;
                } else if (stats.currency !== "" &&
                           stats.currency !== currency) {
                    stats.currency = "";
                    stats.currentCellType = "string";
                    cellValue = value;
                } else {
                    cellValue = numValue;
                }
            }
            if (stats.integerValued && numValue !== Math.floor(numValue))
                stats.integerValued = false;
        } else {
            stats.currentCellType = "string";
            if (this.stringCache.has(value))
                value = this.stringCache.get(value);
            else
                this.stringCache.set(value, value);
                
            if (DataParser.dateTest.test(value))
                stats.possibleDateCount++;
            cellValue = value;
        }

        return cellValue;
    }

    updateColumnStats(rowNr: number, colNr: number, value: any,
                      stats: DataPathStatistics): void
    {
        if(stats.type !== stats.currentCellType) {
            if (stats.type === "undefined") {
                stats.type = stats.currentCellType;
                if (stats.currentCellType === "number" ||
                    stats.currentCellType === "currency") {
                    stats.min = value;
                    stats.max = value;
                }
            } else if (value !== undefined && stats.type !== "mixed") {
                if (stats.type === "currency") {
                    this.cancelCurrency(rowNr, colNr, stats);
                    stats.currency = "";
                    if (stats.currentCellType !== "string")
                        stats.type = "mixed";
                    else
                        stats.type = "string";
                } else
                    stats.type = "mixed";
                
                stats.min = undefined;
                stats.max = undefined;
            }
        } else if (stats.currentCellType === "number" ||
                   stats.currentCellType === "currency") {
            if (stats.min > value)
                stats.min = value;
            if (stats.max < value)
                stats.max = value;
        }
        
        stats.typeCount[stats.currentCellType]++;
        if (stats.currentCellType === "number" ||
            stats.currentCellType === "currency") {
            if (value > 0)
                stats.typeCount.nrPositive++;
            else if (value < 0)
                stats.typeCount.nrNegative++;
        }
        if (stats.currentCellType !== "undefined") {
            var cnt = stats.valueCount.get(value);
            if (cnt !== undefined)
                stats.valueCount.set(value, cnt + 1);
            else {
                stats.valueCount.set(value, 1);
                stats.typeCount.nrUnique++;
                stats.typeCount.nrUniqueValuesPerType[stats.currentCellType]++;
                if (stats.uniqueValues !== undefined) {
                    if (stats.uniqueValues.length >
                        this.maxExpectedUniqueValues) {
                        // Stop storing at 12*ln(size) different values
                        stats.uniqueValues = undefined;
                    } else
                        stats.uniqueValues.push(value);
                }
            }
        }
    }

    abstract cancelCurrency(rowNr: number, colNr: number,
                            stats: DataPathStatistics): void
    
    // return the attribute info object just added
    
    setColumnInfo(name: string, originalName: string,
                  stats: DataPathStatistics): DataSourceAttributesInfo
    {
        var attr: DataSourceAttributesInfo = {
            name: [name],
            type: stats.type === "number" && stats.integerValued ?
                ["integer"]: [stats.type],
            typeCount: normalizeObject(stats.typeCount)
        };
        if (name !== originalName){
            attr.originalName = [originalName];
        }
        if (stats.min !== undefined) {
            attr.min = [stats.min];
            attr.max = [stats.max];
        }
        if (stats.uniqueValues !== undefined && stats.type !== "currency") {
            attr.uniqueValues = stats.uniqueValues;
        }
        if (stats.type === "currency") {
            attr.currency = [stats.currency];
        }
        this.attributes.push(attr);
        return attr;
    }

    // add a column with record ID (starting from 0). 'nrRows' should be
    // the actual number of rows read from the data.
    addRecordIdColumn(): void
    {
        var recordIds: number[] = [];
        
        for (var i: number = 0; i < this.nrRows; i++)
            recordIds.push(i);
        
        this.dataPerFacet["recordId"] = recordIds;
        this.attributes.push({
            name: ["recordId"],
            type: ["integer"],
            min: [1],
            max: [this.nrRows],
            typeCount: [{
                number: [this.nrRows],
                string: [0],
                object: [0],
                undefined: [0],
                boolean: [0],
                currency: [0],
                nrPositive: [this.nrRows],
                nrNegative: [0],
                nrUnique: [this.nrRows],
                nrUniqueValuesPerType: [{
                    number: [this.nrRows],
                    string: 0,
                    object: 0,
                    boolean: 0,
                    currency: 0
                }]
            }]
        });
    }
}

// This class provides and objects which tracks various statistics when
// loading a column in a data table.

class DataPathStatistics
{
    name: string; // unique path name
    type: string;
    currentCellType: string; // the type of the last cell just processed
    currency: string;
    integerValued: boolean;
    min: number;
    max: number;
    valueCount: Map<any, number>;
    uniqueValues: any[];
    possibleDateCount: number;
    typeCount: any;
    
    constructor(name: string) {
        this.name = name;
        this.type = "undefined";
        this.currency = undefined;
        this.integerValued = true;
        this.min = undefined;
        this.max = undefined;
        this.valueCount = new Map<any, number>();
        this.uniqueValues = [];
        this.possibleDateCount = 0;
        this.typeCount = {
            number: 0,
            string: 0,
            object: 0,
            undefined: 0,
            boolean: 0,
            currency: 0,
            nrPositive: 0,
            nrNegative: 0,
            nrUnique: 0,
            nrUniqueValuesPerType: {
                number: 0,
                string: 0,
                object: 0,
                boolean: 0,
                currency: 0
            }
        };
    }
}

// This class parses an input string into a table structure.

abstract class MatrixDataParser extends DataParser
{
    // a string representing the raw data which needs to be parsed.
    rawData: string;
    // Indicates which format the input is in (e.g. csv, tsv, etc.).
    // Not all possible formats are necessarily supported by this class.
    // If called with an incompatible format, no parsing will take place.
    dataFormat: DataSourceFileType;
    onlyFirstBlock: boolean;
    matrix: any[][];
    
    protected originalAttributes: {[attr: string]: string};
    protected fixedUpNames: string[];
    protected facetRestrictionQuery: any;

    // If 'onlyFirstBlock' is true, the matrix is parsed only until the
    // first empty line is reached.
    constructor(rawData: string, dataFormat: DataSourceFileType,
                onlyFirstBlock: boolean)
    {
        super();
        this.rawData = rawData;
        this.dataFormat = dataFormat;
        this.onlyFirstBlock = onlyFirstBlock; 
        this.matrix = [];

        // auxiliary parsing fields
        this.originalAttributes = { recordId: "recordId" };
        this.fixedUpNames = [];
        this.facetRestrictionQuery = undefined;
    }

    // parses the raw data into a matrix of values (exact implementation
    // depends on the input format and is handled in the appropriate
    // derived class).
    abstract parseRawData(): void;
    
    //
    // Finding the headers
    //
    
    isHeaderRow(r: string[]): boolean {
        return r.every(s => s !== undefined && /[^0-9]/.test(s));
    }

    isEmptyRow(r: string[]): boolean {
        return r.every(s => s === undefined);
    }

    // remove first lines so that the header line becomes the first line.
    findHeaders(): void {
        var headerStart: number = 0;

        while (headerStart <this.matrix.length - 2 &&
               this.isEmptyRow(this.matrix[headerStart])) {
            headerStart++;
        }
        while (headerStart < this.matrix.length - 2 &&
               this.matrix[headerStart].length <
               this.matrix[headerStart + 1].length &&
               this.isHeaderRow(this.matrix[headerStart + 1])) {
            headerStart++;
        }
        if(headerStart !== 0)
            this.matrix = this.matrix.slice(headerStart);
    }

    // after making sure the first row is the header row, extract the
    // column headers from that row
    setColumnHeaders() {
        this.columnHeaders =
            this.matrix[0].map(function(value: string, i: number): string {
                return value === undefined? "column " + i: value;
            });
    }

    // if only the first block (up to the first empty row) is part of the
    // table, this function removes all remaining rows.
    trimAfterFirstBlock() {
        for (var i = 1; i <= this.nrRows; i++) {
            var row_i: string[] = this.matrix[i];
            if (row_i.every(s => s === undefined)) {
                this.nrRows = i - 1;
                break;
            }
        }
    }

    createFacetRestrictionQuery() {
        if (dataTableFacetRestriction === undefined)
            return;
        
        var facetqs = dataTableFacetRestriction.split(",");
        this.facetRestrictionQuery = {};
        for (var i = 0; i < facetqs.length; i++) {
            var facetq = facetqs[i];
            var qvalue: any = facetq[0] === "+"? new RangeValue([1,Infinity], true, false): 0;
            var qattr: string = facetq.slice(1);
            this.facetRestrictionQuery[qattr] = qvalue;
        }
    }

    //
    // Conversion
    //

    fixUpAttribute(attr: string): string {
        if (attr === "") {
            attr = "unknown";
        }
        if (!(attr in this.originalAttributes)) {
            this.originalAttributes[attr] = attr;
            return attr;
        }
        var suffix: number = 0;
        var nAttr: string;
        do {
            suffix++;
            nAttr = attr + " " + suffix;
        } while (nAttr in this.originalAttributes);
        this.originalAttributes[nAttr] = attr;
        return nAttr;
    }

    // Removes the currency marking from the given column, and puts back the
    // original strings.
    cancelCurrency(rowNr: number, colNr: number,
                   stats: DataPathStatistics): void
    {
        var attr: string = stats.name;
        var column: any[] = this.dataPerFacet[attr];
        for (var i: number = 0; i < rowNr; i++) {
            column[i] = this.matrix[rowNr + 1][colNr];
        }
    }    

    // main function which takes the data in rawData, parses it, and create
    // a table structure.
    loadData(): void {
        this.parseRawData();
        // remove leading rows so that the first row is the header row. 
        this.findHeaders();
        // extract the column headers
        this.setColumnHeaders();
        // number of rows to process in the matrix
        this.nrRows = (dataTableMaxNrRows !== undefined &&
                       dataTableMaxNrRows < this.matrix.length) ?
            dataTableMaxNrRows : this.matrix.length - 1;
        if(this.onlyFirstBlock)
            this.trimAfterFirstBlock();
        this.createFacetRestrictionQuery();

        this.maxExpectedUniqueValues = 12 * Math.log(this.nrRows - 1);
        
        for (var j: number = 0; j < this.columnHeaders.length; j++) {
            this.loadColumn(j);
            
            if (this.attributes.length >= dataTableMaxNrColumns)
                break;
        }

        // convert dates to time values
        this.convertDates();

        // add the 'record ID' column
        this.addRecordIdColumn();
    }

    loadColumn(colNr: number): void {
        // fix the name of the column, if necessary
        var originalName: string = this.columnHeaders[colNr];
        var name: string = this.fixUpAttribute(originalName);
        var stats: DataPathStatistics = new DataPathStatistics(name);
        var column: any[] = new Array(this.nrRows);
        
        this.fixedUpNames.push(name);

        for (var i: number = 0; i < this.nrRows; i++) {
            var cellValue: any =
                this.getCellValue(this.matrix[i + 1][colNr], true, stats);
            column[i] = cellValue;
            this.updateColumnStats(i, colNr, cellValue, stats);
        }

        // if there are restrictions on the columns to be loaded, check them.
        if (this.facetRestrictionQuery !== undefined &&
            !interpretedBoolMatch(this.facetRestrictionQuery,
                                  stats.typeCount))
            return;

        // store the column
        this.dataPerFacet[name] = column;

        // store column information
        var columnInfo: DataSourceAttributesInfo =
            this.setColumnInfo(name, originalName, stats);

        // determine whether this column is a possible date column
        if(stats.possibleDateCount === stats.typeCount.string &&
           stats.typeCount.number === 0 && stats.typeCount.object === 0 &&
           stats.typeCount.boolean === 0 && stats.typeCount.currency === 0)
            this.possibleDate.push(columnInfo);
    }

    // Converts the per-column data to an array of A-Vs where the attributes
    // of the A-Vs are the column names.
    
    getDataAsOSOfAVs(): any[]
    {
        var res: any[] = [];

        for (var attr in this.dataPerFacet) {
            var col = this.dataPerFacet[attr];
            for (var i: number = 0; i < col.length; i++) {
                var value = col[i];
                if (value !== undefined) {
                    if (res[i] === undefined) {
                        res[i] = {};
                    }
                    res[i][attr] = value;
                }
            }
        }
        return res;
    }
}

// This class is used to parse a matrix when it is known that the input is
// in tsv (comma separated values) format.

class TsvMatrixDataParser extends MatrixDataParser
{
    constructor(rawData: string, onlyFirstBlock: boolean)
    {
        super(rawData, DataSourceFileType.tsv, onlyFirstBlock);
    }

    // This function parses the input string into a matrix of rows and columns.
    parseRawData() {
        if(this.rawData === undefined)
            return;
        this.matrix = this.rawData.split(/\r?\n/).
            map(function(line: string): string[] {
                return line.split('\t');
            });
    }
}

// This class is used to parse a matrix when it is known that the input is
// in csv (comma separated values) format.

class CsvMatrixDataParser extends MatrixDataParser
{
    constructor(rawData: string, onlyFirstBlock: boolean)
    {
        super(rawData, DataSourceFileType.csv, onlyFirstBlock);
    }

    // This function parses the input string into a matrix of rows and columns.
    parseRawData() {
        if(this.rawData === undefined)
            return;

        // make available for function in this context
        var rawData: string = this.rawData;
        var matrix: string[][] = this.matrix;
        
        var row: any[] = undefined;
        
        function addRow(): void {
            if (row !== undefined) {
                matrix.push(row);
                row = undefined;
            }
        }

        var startPos: number = undefined;
        var endPos: number = undefined;
        var percentPos: number = undefined;
        var doubleQuote: boolean;

        function addField(): void {
            var val: any;

            if (startPos === undefined || endPos === undefined) {
                val = undefined;
            } else if (percentPos !== endPos) {
                val = rawData.substring(startPos, endPos + 1);
                if (doubleQuote) {
                    val = val.replace(/""/g, '"');
                }
            } else {
                var numVal: number = Number(rawData.substring(startPos, endPos));
                if (isNaN(numVal) || numVal === Infinity || numVal === -Infinity) {
                    val = rawData.substring(startPos, endPos + 1);
                    if (doubleQuote) {
                        val = val.replace(/""/g, '"');
                    }
                } else {
                    val = numVal / 100;
                }
            }
            if (row === undefined) {
                row = [val];
            } else {
                row.push(val);
            }
            startPos = undefined;
            endPos = undefined;
        }

        // Parse CSV with a finite state machine
        var l: number = rawData.length;
        var state: number = 0;
        var prevCh: string;
        for (var i: number = 0; i !== l; i++) {
            var ch: string = rawData[i];
            switch (state) {
              case 0: // initial state, start of a field
                doubleQuote = false;
                percentPos = undefined;
                switch (ch) {
                  case '"':
                    startPos = i + 1;
                    state = 1;
                    break;
                  case ",":
                    addField();
                    break;
                  case "\n": case "\r":
                    if (prevCh !== "\n" && prevCh !== "\r") {
                        addField();
                        addRow();
                    }
                  case " ": case "\t":
                    break;
                  default:
                    startPos = endPos = i;
                    state = 3;
                    break;
                }
                break;
              case 1: // start quoted string
                switch (ch) {
                  case '"': // double quote or terminate string
                    endPos = i - 1;
                    state = 2;
                    break;
                }
                break;
              case 2: // escaped character in double quoted string
                switch (ch) {
                  case '"': // double quote
                    doubleQuote = true;
                    state = 1;
                    break;
                  case ",":
                    addField();
                    state = 0;
                    break;
                  case "\n": case "\r":
                    if (prevCh !== "\n" && prevCh !== "\r") {
                        addField();
                        addRow();
                    }
                    state = 0;
                    break;
                }
                break;
              case 3: // unquoted field
                switch (ch) {
                  case ",":
                    addField();
                    state = 0;
                    break;
                  case " ": case "\t":
                    break;
                  case "%":
                    percentPos = i;
                    endPos = i;
                    break;
                  case "\n": case "\r":
                    if (prevCh !== "\n" && prevCh !== "\r") {
                        addField();
                        addRow();
                    }
                    state = 0;
                    break;
                  default:
                    endPos = i;
                    break;
                }
                break;
            }
            prevCh = ch;
        }
        if (prevCh !== "\n" && prevCh !== "\r") {
            addField();
            addRow();
        }
    }
}

// This class parses an input string which is in JSON format. It converts
// it into a JS object and determines the statistics of its different
// attribute paths.

class JsonDataParser extends DataParser
{
    // a string representing the raw data which needs to be parsed.
    rawData: string;
    data: any;
    errMsg: string;
    attributeToIndex: {[attr: string]: number};
    pathStats: DataPathStatistics[];
    nrColumns: number;

    // The indexes in the 'data' array of objects where the data was
    // determined to be 'empty'.
    protected emptyPositions: number[];
    
    constructor(rawData: string)
    {
        super();
        
        this.rawData = rawData;
        this.data = undefined;
        this.errMsg = undefined;

        this.attributeToIndex = {};
        this.pathStats = [];
        this.nrColumns = 0;

        this.emptyPositions = [];
    }

    // parses the raw data (which is a string describing data in JSON format)
    // into a JS object structure. The input is the 'rawData' of this object
    // and the result is placed on the this.data.
    parseRawData(): void {

        try {
            // First try to parse it as one line
            this.data = ensureOS(JSON.parse(this.rawData));
        }
        catch (ignoreError) {
            try {
                // On failure, split the data into lines, and JSON.parse them
                // individually; skip empty lines and lines starting with the
                // JS comment symbol
                this.data = this.rawData.split(/[\n\r]+/).
                    map(function(line: string, lineNr: number): any {
                        if (line === "" || line.startsWith("//")) {
                            return undefined;
                        }
                        try {
                            return JSON.parse(line);
                        } catch (err) {
                            throw err + " in line " + String(lineNr + 1);
                        }
                    });
            } catch (errMsg) {
                this.errMsg = errMsg;
                return;
            }
        }        
    }

    loadData(): void {
        this.parseRawData();

        if(this.errMsg !== undefined)
            return;
        
        this.maxExpectedUniqueValues =
            Math.max(this.data.length / 50, 12 * Math.log(this.data.length));
        
        for (var i: number = 0; i < this.data.length; i++) {
            var obj: any = this.data[i];
            if(!this.loadNextObject(obj)) {
                this.emptyPositions.push(i);
                continue; // empty object
            }
            this.nrRows++;
        }

        // set the attribute information objects
        for(var i: number = 0, l: number = this.pathStats.length ; i < l ; ++i){
            var stats: DataPathStatistics = this.pathStats[i];
            var columnInfo: DataSourceAttributesInfo =
                this.setColumnInfo(stats.name, stats.name, stats);
            // determine whether this column is a possible date column
            if(stats.possibleDateCount === stats.typeCount.string &&
               stats.typeCount.number === 0 && stats.typeCount.object === 0 &&
               stats.typeCount.boolean === 0 && stats.typeCount.currency === 0)
                this.possibleDate.push(columnInfo);
        }

        // convert dates to time values
        this.convertDates();
        
        // add the 'record ID' column
        this.addRecordIdColumn();
    }

    // returns false if the object is empty (or a terminal value)
    loadNextObject(obj: any): boolean {
        if (typeof(obj) !== "object" || obj === null)
            return false;

        var empty: boolean = true;

        for (var attr in obj) {
            var value: any = obj[attr];
            var index: number = this.attributeToIndex[attr];
            if (index === undefined)
                index = this.assignNewPath(attr);
            var stats: DataPathStatistics = this.pathStats[index];
            var cellValue: any = this.getCellValue(value, false, stats);

            if(cellValue !== undefined) {
                empty = false;
                this.dataPerFacet[attr][this.nrRows] = cellValue; 
            }
            this.updateColumnStats(this.nrRows, index, cellValue, stats);
        }

        return !empty;
    }

    assignNewPath(attr: string): number {
        
        var index: number = this.nrColumns++;
        this.attributeToIndex[attr] = index;
        this.dataPerFacet[attr] = [];
        this.columnHeaders[index] = attr;
        this.pathStats[index] = new DataPathStatistics(attr);
        
        return index;
    }

    // Removes the currency marking from the given path, and puts back the
    // original values (strings). 'rowNr' is the row up to which the values
    // were already added to the column. 'colNr' is the index assigned to
    // this column.
    cancelCurrency(rowNr: number, colNr: number,
                   stats: DataPathStatistics): void
    {
        var attr: string = stats.name;
        var column = this.dataPerFacet[attr];
        // current position in list of empty objects
        var emptyPosIndex: number = 0;
        // index of first empty object (may be undefined)
        var nextEmptyPos: number = this.emptyPositions[0];
        var posInCol: number = 0;
        
        for (var i: number = 0; i < this.data.length; i++) {
            if(i === nextEmptyPos) {
                // skip this object, it is empty and not in the column
                emptyPosIndex++;
                nextEmptyPos = this.emptyPositions[emptyPosIndex];
                continue;
            }
            if(column[posInCol] !== undefined)
                column[posInCol] = this.data[i][attr];
            if(++posInCol >= rowNr)
                break; // done
        }
    }

    // simply return the data, as parsed. 
    getDataAsOSOfAVs(): any[]
    {
        return this.data ? this.data : [];
    }
}
