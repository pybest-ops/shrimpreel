// Clarity 官方引导代码：正式域名才加载；水合与客户端切页重复执行时，复用已有实例。
export function clarityBootstrapScript(clarityId: string, domain: string) {
  const host = JSON.stringify(domain)
  const id = JSON.stringify(clarityId)
  return `if(!window.clarity&&(location.hostname===${host}||location.hostname.endsWith('.'+${host}))){(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${id});}`
}
