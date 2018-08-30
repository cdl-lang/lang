/**
 * Specification of a command line argument.
 * 
 * Command line argument are not preceded by a hyphen, and must appear in
 * order. A typeical command line argument is the input file name.
 * 
 * Each command line argument must specify the name of the attribute under which
 * its content is returned in `field`. If the argument is optional, `required`
 * should be set to true. If it can be repeated, `multiple` should be set to
 * true (in which case, the attribute's value will be an array of strings).
 * 
 * Note that all arguments following the first optional one should be optional,
 * and that only the last argument can be repeated.
 */
export interface CommandLineArgument {
    /**
     * Name of the attribute under which the value will be stored.
     */
    field: string;
    required?: boolean;
    multiple?: boolean;
}

/**
 * Specification of a command line option.
 * 
 * Command line options are preceded by a hyphen, have an optional extra
 * argument, and can be placed in any order throughout the command line.
 * 
 * By default, the value of an option is stored under its literal string, but
 * this can be overridden by specifying `field`. For short, single character
 * options, an long option alias can be given.
 * 
 */
export interface CommandLineOption {
    /**
     * For short options, the name of the long option that is its synonym; this
     * will provide the specification and the name to store the value. When
     * specified, the other elements are ignored.
     */
    alias?: string;
    /**
     * Name of the attribute under which the value will be stored; by default,
     * it's the same as the option.
     */
    field?: string;
    /**
     * When true, there will be an error message if the option is missing from
     * the command line.
     */
    required?: boolean;
    /**
     * When true, the value of the option will be
     * - the next argument if the option is finished
     * - the rest of the argument in case of a short option
     * - the string following '=' in case of a long option
     */
    argument?: boolean;
    /**
     * List of allowed values
     */
    values?: string[];
    /**
     * Default value for the option; must be in the values list.
     */
    default?: string;
    /**
     * When true, the option can be repeated, and its value will be an array
     * of strings; when false, repeating the option will result in an error, and
     * the value will be a single string.
     */
    multiple?: boolean;
}

/**
 * Parses the command line arguments.
 * 
 * @param argv traditional argv (argv[0] is the command, argv[1] is the first argument)
 * @param commandLineArguments Arguments that are not options and appear in order
 * @param commandLineOptions1 Short, single character options
 * @param commandLineOptions2 Long options
 */
export function parse(
    argv: string[],
    commandLineArguments: CommandLineArgument[],
    commandLineOptions1: {[arg: string]: CommandLineOption},
    commandLineOptions2: {[arg: string]: CommandLineOption}
): any {
    let result: any = {};
    let nArgs: number = 0;
    let argi = 1;

    function usage(message?: string): never {
        console.error("usage:", argv[0], commandLineArguments.map(argDesc => {
            const rep = argDesc.multiple? argDesc.field + " ...": argDesc.field;
            const opt = argDesc.required? rep: "[" + rep + "]";
            return opt;
        }).join(" "));
        if (message !== undefined) {
            console.error(message);
        }
        return process.exit(1);
    }

    function addArgument(arg: string): void {
        if (nArgs >= commandLineArguments.length) {
            return usage();
        }
        const argDesc = commandLineArguments[nArgs];
        if (argDesc.multiple) {
            if (!(argDesc.field in result)) {
                result[argDesc.field] = [];
            }
            result[argDesc.field].push(arg);
        } else {
            result[argDesc.field] = arg;
            nArgs++;
        }
    }

    function addOption(attr: string, val: string|undefined, argDesc: CommandLineOption): void {
        if (val === undefined && argDesc.argument) {
            return usage(`--${attr}: missing value`);
        } else if (val !== undefined && !argDesc.argument) {
            return usage(`--${attr}: doesn't take value`);
        }
        if (val !== undefined && argDesc.values !== undefined &&
            argDesc.values.indexOf(val) === -1) {
            return usage(`--${attr}: doesn't allow value ${val}`);
        }
        const field = argDesc.field !== undefined? argDesc.field: attr;
        if (argDesc.multiple) {
            if (!(field in result)) {
                result[field] = [];
            }
            result[field].push(!argDesc.argument? true: val);
        } else {
            if (field in result) {
                return usage(`${attr} repeated`);
            }
            result[field] = !argDesc.argument? true: val;
        }
    }

    function addOption1(arg: string): string {
        const attr1: string = arg.substr(0, 1);
        let rem: string = arg.slice(1);
        let val: string|undefined;
        const argDescr1 = commandLineOptions1[attr1];

        if (argDescr1 === undefined) {
            usage(`-${attr1}: no such option`);
        }
        const attr: string = argDescr1.alias? argDescr1.alias: attr1;
        const argDesc = argDescr1.alias? commandLineOptions2[attr]: argDescr1;
        if (argDesc.argument) {
            // If the value wasn't attached, get the next argv
            if (rem === "") {
                if (argi >= argv.length) {
                    return usage();
                }
                val = argv[argi];
                argi++;
            } else {
                val = rem;
                rem = "";
            }
        }
        addOption(attr, val, argDesc);
        return rem;
    }

    function addOption2(arg: string): void {
        const split = arg.slice(2).split("=");
        const argDesc = commandLineOptions2[split[0]];
        let val: string;

        if (argDesc === undefined) {
            usage(`--${split[0]}: no such option`);
        }
        if (split.length > 2) {
            usage(`--${split[0]}: too many values`);
        }
        if (split.length === 1 && argDesc.argument) {
            // Use next argument as value
            if (argi >= argv.length) {
                return usage();
            }
            val = argv[argi];
            argi++;
        } else {
            val = split[1];
        }
        addOption(split[0], val, argDesc);
    }

    for (; argi < argv.length; argi++) {
        let arg: string = argv[argi];
        if (arg.startsWith("--")) {
            addOption2(arg);
        } else if (arg.startsWith("-")) {
            arg = arg.slice(1);
            while (arg !== "") {
                arg = addOption1(arg);
            }
        } else {
            addArgument(arg);
        }
    }
    if (nArgs < commandLineArguments.length && commandLineArguments[nArgs].required) {
        return usage("not enough arguments");
    }
    for (const attr in commandLineOptions1) {
        if (!(attr in result) && commandLineOptions1[attr].alias === undefined) {
            if (commandLineOptions1[attr].required) {
                return usage(`--${attr} missing`);
            }
            if (commandLineOptions1[attr].default !== undefined) {
                addOption(attr, commandLineOptions1[attr].default, commandLineOptions1[attr]);
            }
        }
    }
    for (const attr in commandLineOptions2) {
        if (!(attr in result)) {
            if (commandLineOptions2[attr].required) {
                return usage(`--${attr} missing`);
            }
            if (commandLineOptions2[attr].default !== undefined) {
                addOption(attr, commandLineOptions2[attr].default, commandLineOptions2[attr]);
            }
        }
    }
    return result;
}
