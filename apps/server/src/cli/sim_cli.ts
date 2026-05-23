const DEFAULT_BASE_URL = 'http://localhost:3001';

const COMMANDS = ['status', 'pause', 'resume', 'speed', 'login'] as const;

interface CliArgs {
  command?: string;
  baseUrl: string;
  token?: string;
  username?: string;
  password?: string;
  speedValue?: string;
  help?: boolean;
  json?: boolean;
}

const parseSimArgs = (argv: string[]): CliArgs => {
  const parsed: CliArgs = { baseUrl: process.env.YIDHRAS_BASE_URL ?? DEFAULT_BASE_URL };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--base-url':
        parsed.baseUrl = argv[++i];
        break;
      case '--token':
        parsed.token = argv[++i];
        break;
      case '--username':
        parsed.username = argv[++i];
        break;
      case '--password':
        parsed.password = argv[++i];
        break;
      default:
        if (COMMANDS.includes(arg as (typeof COMMANDS)[number])) {
          parsed.command = arg;
        } else if (parsed.command === 'speed' && !arg.startsWith('-') && !parsed.speedValue) {
          parsed.speedValue = arg;
        }
    }
  }

  return parsed;
};

const printSimHelp = (): void => {
  console.log(`sim — 模拟控制 (需要服务器运行中)

用法:
  pnpm sim status [--json]                      运行时状态摘要
  pnpm sim pause [--token <token>]              暂停模拟循环
  pnpm sim resume [--token <token>]             恢复模拟循环
  pnpm sim speed <n|reset> [--token <token>]    设置速度倍率 (正整数字面值, reset=恢复默认)
  pnpm sim login --username <u> --password <p>   登录并打印 token
  pnpm sim --help                                 显示此帮助

选项:
  --base-url <url>   服务器地址, 默认 ${DEFAULT_BASE_URL}
  --token <token>    JWT token (或通过 YIDHRAS_TOKEN 环境变量)
  --json, -j         以 JSON 输出
`);
};

interface ApiEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface RuntimeSpeedData {
  runtime_speed: {
    effective_step_ticks: string;
    mode: string;
    source: string;
  } | null;
}

interface RuntimeStatus {
  status: string;
  runtime_ready: boolean;
  runtime_speed: {
    mode: 'variable' | 'adaptive';
    source: 'default' | 'world_pack' | 'override';
    strategy: {
      kind: 'variable' | 'adaptive';
      range: {
        min: string;
        max: string;
      };
      loopIntervalMs: number;
      adaptive?: {
        targetLoopMs: number;
        scaleUpThresholdMs: number;
        scaleDownThresholdMs: number;
      };
    };
    effective_step_ticks: string;
    override_since: number | null;
  } | null;
  runtime_loop: {
    status: string;
    iteration_count: number;
  } | null;
  world_pack: {
    instance_id: string;
    metadata_id: string;
    name: string;
  } | null;
  ai: {
    gateway_enabled: boolean;
  } | null;
}

const request = async <T>(
  baseUrl: string,
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {}
): Promise<T> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const json = (await res.json()) as ApiEnvelope<T>;

  if (!json.success) {
    throw new Error(`API 错误 [${res.status}]: ${json.error?.code ?? 'UNKNOWN'} — ${json.error?.message ?? '请求失败'}`);
  }

  return json.data as T;
};

const getToken = (args: CliArgs): string | undefined => {
  return args.token ?? process.env.YIDHRAS_TOKEN;
};

const doLogin = async (args: CliArgs): Promise<void> => {
  if (!args.username || !args.password) {
    console.error('错误: login 需要 --username 和 --password');
    process.exitCode = 1;
    return;
  }

  const data = await request<{ token: string; operator: Record<string, unknown> }>(
    args.baseUrl,
    '/api/auth/login',
    {
      method: 'POST',
      body: { username: args.username, password: args.password }
    }
  );

  if (args.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`登录成功`);
    console.log(`  token: ${data.token}`);
    console.log(`  operator: ${(data.operator as Record<string, string>).name ?? data.operator}`);
    console.log(`\n使用: export YIDHRAS_TOKEN=${data.token}`);
  }
};

const doStatus = async (args: CliArgs): Promise<void> => {
  const token = getToken(args);

  const health = await request<{ level: string; checks: Record<string, boolean> }>(
    args.baseUrl,
    '/api/health'
  );

  // clock is public (no auth needed)
  let clock: { absolute_ticks: string } | undefined;
  try {
    clock = await request<{ absolute_ticks: string }>(args.baseUrl, '/api/clock');
  } catch {
    // server not fully ready yet
  }

  let status: RuntimeStatus | undefined;
  if (token) {
    try {
      status = await request<RuntimeStatus>(args.baseUrl, '/api/status', { token });
    } catch {
      // silently skip if not root or status unavailable
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ health, clock, status }, null, 2));
    return;
  }

  console.log(`服务器: ${args.baseUrl}`);
  console.log(`  健康状态:   ${health.level}`);
  if (clock) {
    console.log(`  绝对 ticks: ${clock.absolute_ticks}`);
  }

  if (status) {
    console.log(`  运行时:     ${status.runtime_ready ? '就绪' : '未就绪'}`);
    if (status.runtime_speed) {
      const speed = status.runtime_speed;
      console.log(`  速度倍率:   ${speed.effective_step_ticks} (模式: ${speed.mode}, 来源: ${speed.source})`);
    }

    if (status.runtime_loop) {
      const loop = status.runtime_loop;
      console.log(`  循环状态:   ${loop.status} (迭代: ${loop.iteration_count})`);
    }

    if (status.world_pack) {
      const wp = status.world_pack;
      console.log(`  当前包:     ${wp.name} (instance: ${wp.instance_id}, type: ${wp.metadata_id})`);
    }

    if (status.ai) {
      console.log(`  AI 网关:    ${status.ai.gateway_enabled ? '启用' : '禁用'}`);
    }
  } else if (!token) {
    console.log('\n提示: 设置 YIDHRAS_TOKEN 环境变量以查看完整状态');
  }
};

const doPause = async (args: CliArgs): Promise<void> => {
  const token = getToken(args);
  if (!token) {
    console.error('错误: pause 需要认证。使用 --token 或 YIDHRAS_TOKEN 环境变量');
    process.exitCode = 1;
    return;
  }

  const data = await request<{ status: string }>(args.baseUrl, '/api/clock/control', {
    token,
    method: 'POST',
    body: { action: 'pause' }
  });

  console.log(args.json ? JSON.stringify(data) : `模拟已暂停 (状态: ${data.status})`);
};

const doResume = async (args: CliArgs): Promise<void> => {
  const token = getToken(args);
  if (!token) {
    console.error('错误: resume 需要认证。使用 --token 或 YIDHRAS_TOKEN 环境变量');
    process.exitCode = 1;
    return;
  }

  const data = await request<{ status: string }>(args.baseUrl, '/api/clock/control', {
    token,
    method: 'POST',
    body: { action: 'resume' }
  });

  console.log(args.json ? JSON.stringify(data) : `模拟已恢复 (状态: ${data.status})`);
};

const doSpeed = async (args: CliArgs): Promise<void> => {
  const token = getToken(args);
  if (!token) {
    console.error('错误: speed 需要认证。使用 --token 或 YIDHRAS_TOKEN 环境变量');
    process.exitCode = 1;
    return;
  }

  if (!args.speedValue || args.speedValue === 'reset') {
    const data = await request<RuntimeSpeedData>(args.baseUrl, '/api/runtime/speed', {
      token,
      method: 'POST',
      body: { action: 'clear' }
    });
    console.log(args.json ? JSON.stringify(data) : '速度倍率已重置为默认值');
    return;
  }

  const stepTicks = BigInt(args.speedValue);
  if (stepTicks < 0n) {
    console.error('错误: speed 值必须为非负整数字面值');
    process.exitCode = 1;
    return;
  }

  const data = await request<RuntimeSpeedData>(args.baseUrl, '/api/runtime/speed', {
    token,
    method: 'POST',
    body: { action: 'override', step_ticks: args.speedValue }
  });

  if (args.json) {
    console.log(JSON.stringify(data));
  } else {
    const speed = data.runtime_speed;
    console.log(`速度倍率: ${speed?.effective_step_ticks ?? args.speedValue}`);
  }
};

const runCli = async (): Promise<void> => {
  const args = parseSimArgs(process.argv.slice(2));

  if (args.help || !args.command) {
    printSimHelp();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  try {
    switch (args.command) {
      case 'login':
        await doLogin(args);
        break;
      case 'status':
        await doStatus(args);
        break;
      case 'pause':
        await doPause(args);
        break;
      case 'resume':
        await doResume(args);
        break;
      case 'speed':
        await doSpeed(args);
        break;
      default:
        console.error(`错误: 未知命令 "${args.command}"。使用 --help 查看帮助。`);
        process.exitCode = 1;
    }
  } catch (error) {
    console.error('错误:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

void runCli();
