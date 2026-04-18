import { URL } from 'url';
import { ExecuteToolOptions } from './types';

interface ReadRobotsTxtArgs {
  url: string;
  user_agent?: string;
  timeout_ms?: number;
  parse_rules?: boolean;
}

interface RobotsRule {
  user_agent: string;
  allow: string[];
  disallow: string[];
  crawl_delay?: number;
  sitemap?: string[];
}

interface RobotsAnalysis {
  can_crawl: boolean;
  restrictions: string[];
  warnings: string[];
  recommendations: string[];
}

/**
 * Tool: read_robots_txt
 * Lê e interpreta o arquivo robots.txt de um site
 * 
 * Args:
 * - url: string (URL do site)
 * - user_agent: string (user agent para verificar regras, padrão: "*")
 * - timeout_ms: number (timeout em ms, padrão: 5000)
 * - parse_rules: boolean (analisar regras detalhadamente, padrão: true)
 * 
 * Output:
 * {
 *   "exists": true,
 *   "raw_content": "User-agent: *\nDisallow: /admin/\n...",
 *   "rules": [
 *     {
 *       "user_agent": "*",
 *       "allow": ["/public/"],
 *       "disallow": ["/admin/", "/private/"],
 *       "crawl_delay": 5
 *     }
 *   ],
 *   "analysis": {
 *     "can_crawl": true,
 *     "restrictions": ["Não acessar /admin/", "Delay de 5 segundos"],
 *     "warnings": ["Muitas restrições encontradas"],
 *     "recommendations": ["Respeitar crawl_delay"]
 *   },
 *   "sitemaps": ["https://exemplo.com/sitemap.xml"]
 * }
 */
export async function executeReadRobotsTxt(
  args: Record<string, any>,
  options: ExecuteToolOptions
): Promise<any> {
  const params: ReadRobotsTxtArgs = {
    url: String(args.url ?? '').trim(),
    user_agent: String(args.user_agent ?? '*').trim(),
    timeout_ms: Math.max(1000, Math.min(30000, Number(args.timeout_ms ?? 5000))),
    parse_rules: Boolean(args.parse_rules ?? true),
  };

  if (!params.url) {
    throw new Error('read_robots_txt requer uma URL válida no parâmetro "url"');
  }

  // Valida e normaliza a URL
  let baseUrl: URL;
  try {
    baseUrl = new URL(params.url);
  } catch (err) {
    throw new Error(`URL inválida: ${params.url}`);
  }

  // Constrói URL do robots.txt
  const robotsUrl = `${baseUrl.protocol}//${baseUrl.host}/robots.txt`;

  // Configuração do fetch
  const fetchOptions = {
    method: 'GET',
    headers: {
      'User-Agent': 'Jarvis-Robots-Checker/1.0 (+VSCode Extension)',
    },
    redirect: 'follow' as const,
    timeout: params.timeout_ms,
  };

  try {
    // Tenta baixar o robots.txt
    const response = await fetch(robotsUrl, fetchOptions);
    
    if (!response.ok) {
      if (response.status === 404) {
        return {
          exists: false,
          url: robotsUrl,
          message: 'robots.txt não encontrado (404)',
          analysis: {
            can_crawl: true,
            restrictions: [],
            warnings: ['Site não possui robots.txt - crawl livre, mas cuidado com sobrecarga'],
            recommendations: ['Implementar rate limiting manual', 'Respeitar servidor mesmo sem robots.txt'],
          },
        };
      }
      
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const rawContent = await response.text();
    
    if (!params.parse_rules) {
      // Retorna apenas o conteúdo bruto
      return {
        exists: true,
        url: robotsUrl,
        raw_content: rawContent,
        content_length: rawContent.length,
        message: 'Conteúdo do robots.txt retornado sem análise',
      };
    }

    // Parse do robots.txt
    const { rules, sitemaps } = parseRobotsTxt(rawContent);
    
    // Análise para o user-agent específico
    const analysis = analyzeRobotsRules(rules, params.user_agent || '*', baseUrl.host);
    
    // Filtra regras relevantes para o user-agent
    const userAgent = params.user_agent || '*';
    const relevantRules = rules.filter(rule => 
      rule.user_agent === '*' || 
      rule.user_agent.toLowerCase() === userAgent.toLowerCase() ||
      rule.user_agent === userAgent
    );

    return {
      exists: true,
      url: robotsUrl,
      raw_content: rawContent,
      content_length: rawContent.length,
      rules: relevantRules,
      all_rules: rules, // Todas as regras para referência
      sitemaps,
      analysis,
      _parsed_rules_count: rules.length,
      _relevant_rules_count: relevantRules.length,
      _sitemaps_count: sitemaps.length,
    };

  } catch (error: any) {
    const errorMsg = error.message || String(error);
    
    // Se for timeout ou erro de rede, retorna análise básica
    if (errorMsg.includes('timeout') || errorMsg.includes('network') || errorMsg.includes('fetch')) {
      return {
        exists: false,
        url: robotsUrl,
        error: errorMsg,
        analysis: {
          can_crawl: 'unknown',
          restrictions: ['Não foi possível verificar robots.txt'],
          warnings: ['Erro ao acessar robots.txt - proceda com cautela'],
          recommendations: ['Tentar novamente mais tarde', 'Implementar rate limiting conservador'],
        },
        _status: 'fetch_error',
      };
    }
    
    throw new Error(`read_robots_txt falhou: ${errorMsg}`);
  }
}

// Função para fazer parse do conteúdo do robots.txt
function parseRobotsTxt(content: string): { rules: RobotsRule[]; sitemaps: string[] } {
  const lines = content.split('\n');
  const rules: RobotsRule[] = [];
  const sitemaps: string[] = [];
  
  let currentRule: RobotsRule | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Ignora comentários e linhas vazias
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Divide em chave e valor
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    
    const key = trimmed.substring(0, colonIndex).trim().toLowerCase();
    const value = trimmed.substring(colonIndex + 1).trim();
    
    switch (key) {
      case 'user-agent':
        // Finaliza regra anterior se existir
        if (currentRule) {
          rules.push(currentRule);
        }
        
        // Inicia nova regra
        currentRule = {
          user_agent: value,
          allow: [],
          disallow: [],
        };
        break;
        
      case 'allow':
        if (currentRule && value) {
          currentRule.allow.push(value);
        }
        break;
        
      case 'disallow':
        if (currentRule && value) {
          currentRule.disallow.push(value);
        }
        break;
        
      case 'crawl-delay':
        if (currentRule && !isNaN(Number(value))) {
          currentRule.crawl_delay = Number(value);
        }
        break;
        
      case 'sitemap':
        if (value) {
          sitemaps.push(value);
        }
        break;
        
      // Ignora outras diretivas
    }
  }
  
  // Adiciona a última regra
  if (currentRule) {
    rules.push(currentRule);
  }
  
  return { rules, sitemaps };
}

// Função para analisar regras e gerar recomendações
function analyzeRobotsRules(rules: RobotsRule[], userAgent: string, host: string): RobotsAnalysis {
  const analysis: RobotsAnalysis = {
    can_crawl: true,
    restrictions: [],
    warnings: [],
    recommendations: [],
  };
  
  // Encontra regras aplicáveis
  const applicableRules: RobotsRule[] = [];
  
  // Primeiro procura regras específicas para o user-agent
  const specificRules = rules.filter(rule => 
    rule.user_agent.toLowerCase() === userAgent.toLowerCase()
  );
  
  // Depois regras gerais (*)
  const generalRules = rules.filter(rule => rule.user_agent === '*');
  
  applicableRules.push(...specificRules, ...generalRules);
  
  if (applicableRules.length === 0) {
    analysis.restrictions.push('Nenhuma regra específica encontrada para seu user-agent');
    analysis.recommendations.push('Crawling permitido, mas respeite boas práticas');
    return analysis;
  }
  
  // Analisa cada regra aplicável
  let hasDisallowAll = false;
  let hasCrawlDelay = false;
  let totalDisallows = 0;
  let totalAllows = 0;
  
  for (const rule of applicableRules) {
    // Verifica se há disallow: /
    if (rule.disallow.some(path => path === '/')) {
      hasDisallowAll = true;
      analysis.can_crawl = false;
      analysis.restrictions.push(`DISALLOW ALL: User-agent "${rule.user_agent}" não pode crawlear nenhuma página`);
    }
    
    // Conta restrições
    totalDisallows += rule.disallow.length;
    totalAllows += rule.allow.length;
    
    // Adiciona restrições específicas
    for (const path of rule.disallow) {
      if (path && path !== '/') {
        analysis.restrictions.push(`Não acessar: ${path} (regra para ${rule.user_agent})`);
      }
    }
    
    // Verifica crawl-delay
    if (rule.crawl_delay !== undefined) {
      hasCrawlDelay = true;
      analysis.restrictions.push(`Delay entre requests: ${rule.crawl_delay} segundos`);
      analysis.recommendations.push(`Respeitar crawl-delay de ${rule.crawl_delay}s entre requests`);
    }
  }
  
  // Gera warnings e recomendações baseados na análise
  if (hasDisallowAll) {
    analysis.warnings.push('CRAWLING BLOQUEADO: Este site proíbe completamente crawling para seu user-agent');
    analysis.recommendations.push('Considere entrar em contato com o administrador do site para permissão');
  } else if (totalDisallows > 10) {
    analysis.warnings.push('Muitas restrições encontradas - crawler limitado');
    analysis.recommendations.push('Foque apenas nas áreas permitidas (allow)');
  }
  
  if (!hasCrawlDelay && totalDisallows > 0) {
    analysis.recommendations.push('Implemente delay entre requests mesmo sem crawl-delay especificado');
  }
  
  if (totalAllows > 0) {
    analysis.recommendations.push(`Priorize acesso às ${totalAllows} áreas explicitamente permitidas`);
  }
  
  if (analysis.can_crawl && totalDisallows === 0 && totalAllows === 0) {
    analysis.warnings.push('Nenhuma regra explícita encontrada - crawling livre');
    analysis.recommendations.push('Seja conservador: implemente rate limiting e evite sobrecarregar o servidor');
  }
  
  // Recomendação geral
  analysis.recommendations.push('Sempre verifique robots.txt antes de iniciar crawling em larga escala');
  analysis.recommendations.push('Respeite o servidor - evite requests simultâneas em excesso');
  
  return analysis;
}