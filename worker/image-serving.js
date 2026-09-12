import appWorker from './design-chat.js';
import {serveImageAsset} from './image-pipeline/ai-image-pipeline.js';

export default {
  async fetch(request,env,context){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/images/'))return serveImageAsset(request,env);
    return appWorker.fetch(request,env,context);
  }
};
