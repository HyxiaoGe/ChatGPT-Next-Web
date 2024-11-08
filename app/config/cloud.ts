import {safeLocalStorage} from "@/app/utils";

const localStorage = safeLocalStorage();

export class YliyunCloud{

    private static instance: YliyunCloud;

    constructor(
        public enabled: boolean = true,
        public apiKey: string = '',
        public host: string = '',
        public listUrl: string = '',
        public uploadUrl: string = '',
        public downloadUrl: string = ''
    ) {}

    static getInstance(): YliyunCloud{
        if(!YliyunCloud.instance){
            const config = localStorage.getItem("cloudConfig");
            YliyunCloud.instance = config
                ? new YliyunCloud(...JSON.parse(config))
                : new YliyunCloud();
        }
        return YliyunCloud.instance;
    }

    init(config: Partial<YliyunCloud>){
        Object.assign(this, config);
        localStorage.setItem("cloudConfig", JSON.stringify(this));
    }

    open() {
        if (!this.enabled) {
            throw new Error('Cloud service is not enabled');
        }
    }

}