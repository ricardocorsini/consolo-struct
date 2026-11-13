import {
  ArrowDownToLine,
  BookOpen,
  Box,
  Copy,
  Camera,
  Palette,
  Tag,
  Type,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  Grid2X2,
  Hand,
  Layers3,
  ListChecks,
  Maximize,
  Moon,
  MousePointer2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PencilLine,
  Ruler,
  Save,
  Scissors,
  SlidersHorizontal,
  Table2,
  Trash2,
  Workflow,
  ZoomIn,
  ZoomOut,
  Plus,
  RectangleHorizontal,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

type Command = { label: string; icon: LucideIcon; tip: string };
const command = (label: string, icon: LucideIcon, tip: string): Command => ({
  label,
  icon,
  tip,
});

// Identidades compartilhadas; a composição abaixo varia apenas a apresentação.
export const ribbonCommands = {
  new: command(
    "Novo projeto",
    FilePlus2,
    "Criar um projeto após confirmar seus dados",
  ),
  open: command(
    "Abrir",
    FolderOpen,
    "Abrir um projeto .consolo.json ou .lume.json",
  ),
  save: command(
    "Salvar projeto",
    Save,
    "Salvar todas as peças em um projeto reabrível .consolo.json",
  ),
  project: command(
    "Dados do projeto",
    SlidersHorizontal,
    "Editar nome, cliente e responsável pelo projeto",
  ),
  add: command("Novo consolo", Plus, "Adicionar uma peça ao projeto"),
  duplicate: command(
    "Duplicar",
    Copy,
    "Duplicar os parâmetros da peça selecionada",
  ),
  rename: command(
    "Identificação da peça",
    PencilLine,
    "Editar identificação, descrição e quantidade da peça selecionada",
  ),
  delete: command(
    "Excluir",
    Trash2,
    "Excluir a peça selecionada após confirmação; a última peça é protegida",
  ),
  select: command(
    "Selecionar",
    MousePointer2,
    "Voltar à vista de modelo para selecionar elementos e editar cotas",
  ),
  pan: command(
    "Pan",
    Hand,
    "Voltar à vista de modelo para arrastar · botão do meio ou Espaço + arrastar",
  ),
  geometry: command("Geometria", Ruler, "Editar dimensões da peça selecionada"),
  loads: command(
    "Ações da peça",
    ArrowDownToLine,
    "Editar forças e coeficientes da peça selecionada",
  ),
  materials: command(
    "Materiais",
    Layers3,
    "Editar concreto e aço da peça selecionada",
  ),
  rebar: command(
    "Editar armaduras",
    Workflow,
    "Editar quantidades e bitolas da peça selecionada",
  ),
  elevation: command(
    "Elevação",
    Ruler,
    "Abrir ou reabrir a elevação da peça selecionada",
  ),
  section: command(
    "Seção A–A",
    Layers3,
    "Abrir ou reabrir a seção da peça selecionada",
  ),
  three: command(
    "Vista 3D",
    Box,
    "Abrir ou reabrir a visualização 3D da peça selecionada",
  ),
  fit: command(
    "Ajustar à tela",
    Maximize,
    "Voltar à vista de modelo e enquadrar o desenho; não enquadra o detalhamento · F",
  ),
  zoomIn: command(
    "Aumentar zoom",
    ZoomIn,
    "Voltar à vista de modelo e aumentar seu zoom",
  ),
  zoomOut: command(
    "Diminuir zoom",
    ZoomOut,
    "Voltar à vista de modelo e diminuir seu zoom",
  ),
  calculate: command(
    "Calcular",
    ListChecks,
    "Voltar à vista de modelo e calcular a revisão atual da peça selecionada",
  ),
  autodesign: command(
    "Sugerir armaduras",
    Layers3,
    "Calcular e adotar uma sugestão de armaduras; pode modificar a peça e participa do histórico",
  ),
  design: command(
    "Critérios da peça selecionada",
    SlidersHorizontal,
    "Abrir os critérios de cálculo da peça selecionada; não são preferências globais",
  ),
  export: command(
    "Exportar",
    Download,
    "Escolher entre projeto editável, cálculo auditável, memória, contorno e quantidades",
  ),
  dimensions: command(
    "Mostrar cotas",
    Ruler,
    "Mostrar ou ocultar cotas nas vistas de modelo",
  ),
  steel: command(
    "Mostrar armaduras",
    Workflow,
    "Mostrar ou ocultar armaduras nas vistas de modelo; não edita bitolas",
  ),
  forces: command(
    "Mostrar cargas",
    ArrowDownToLine,
    "Mostrar ou ocultar as cargas nas vistas de modelo; não edita forças",
  ),
  grid: command(
    "Mostrar grade",
    Grid2X2,
    "Mostrar ou ocultar a grade nas vistas de modelo",
  ),
  browser: command(
    "Navegador do projeto",
    PanelLeft,
    "Abrir ou fechar a árvore de peças e documentos",
  ),
  properties: command(
    "Propriedades",
    PanelRight,
    "Abrir ou fechar o painel de propriedades da peça",
  ),
  checks: command(
    "Verificações",
    PanelBottom,
    "Voltar à vista de modelo e expandir ou recolher suas verificações",
  ),
  theme: command(
    "Tema escuro",
    Moon,
    "Ativar ou desativar o tema escuro; preferência do aplicativo",
  ),
  updates: command(
    "Verificar atualizações",
    RefreshCw,
    "Consultar o catálogo assinado do OpenStruct; não baixa nem instala sem confirmação",
  ),
  pdf: command(
    "Memória PDF",
    FileText,
    "Exportar diretamente a memória de cálculo da peça em PDF",
  ),
  dxf: command(
    "Geometria DXF",
    Layers3,
    "Exportar diretamente contornos em milímetros; para barras e quadro de aço, use Detalhamento",
  ),
  svg: command(
    "Geometria SVG",
    Ruler,
    "Exportar diretamente o contorno geométrico; para desenhos de barras, use Detalhamento",
  ),
  csv: command(
    "Quantidades CSV",
    Table2,
    "Exportar diretamente quantidades do projeto; não é o Quadro CSV do detalhamento",
  ),
  report: command(
    "Memória",
    BookOpen,
    "Abrir ou reabrir a memória de cálculo da peça selecionada",
  ),
  details: command(
    "Detalhamento",
    Ruler,
    "Abrir ou reabrir desenhos e quadro de aço, com exportações próprias em centímetros",
  ),
  pieces: command(
    "Peças do projeto",
    Table2,
    "Abrir ou reabrir a lista de peças e quantidades do projeto",
  ),
  strutLimit: command(
    "Limite da biela da peça selecionada",
    SlidersHorizontal,
    "Configurar o critério da biela da peça selecionada; mantém o padrão conservador e não muda outras peças",
  ),
  materialSafety: command(
    "Coeficientes dos materiais da peça selecionada",
    SlidersHorizontal,
    "Editar γc e γs da peça selecionada e conferir o par de referência do processo de produção",
  ),
  excessConcrete: command(
    "Concreto excedente da peça selecionada",
    Scissors,
    "Manter a geometria original ou remover o concreto dispensável abaixo da biela da peça selecionada",
  ),
  barArrangement: command(
    "Armado como viga",
    RectangleHorizontal,
    "Detalhar o tirante e a armadura positiva da peça selecionada como numa viga, com dobras nas duas extremidades; exige manter o concreto excedente",
  ),
};
export type Action = keyof typeof ribbonCommands;
export const ribbonTabs = [
  "Arquivo",
  "Início",
  "Modelo",
  "Exibir",
  "Documentação",
  "Configurações",
] as const;
export type RibbonTab = (typeof ribbonTabs)[number];
type ActionTool = { action: Action; large?: boolean };
type FutureTool = { future: string; label: string; icon: LucideIcon };
export type RibbonTool = ActionTool | FutureTool;
type Group = {
  id: string;
  label: string;
  description?: string;
  tools: RibbonTool[];
};
const tool = (action: Action, large = false): ActionTool => ({ action, large });
const future = (id: string, label: string, icon: LucideIcon): FutureTool => ({
  future: id,
  label,
  icon,
});

export const ribbonGroups: Record<RibbonTab, Group[]> = {
  Arquivo: [
    {
      id: "project",
      label: "Projeto",
      tools: [tool("new", true), tool("open", true), tool("save", true)],
    },
    { id: "information", label: "Informações", tools: [tool("project", true)] },
    { id: "output", label: "Saída", tools: [tool("export", true)] },
  ],
  Início: [
    {
      id: "prepare",
      label: "Preparação",
      tools: [tool("add", true), tool("geometry"), tool("loads")],
    },
    {
      id: "calculate",
      label: "Cálculo",
      tools: [tool("calculate", true), tool("autodesign", true)],
    },
    {
      id: "documents",
      label: "Documentação",
      tools: [
        tool("report", true),
        tool("details", true),
        tool("export", true),
      ],
    },
  ],
  Modelo: [
    {
      id: "pieces",
      label: "Peças",
      tools: [
        tool("add", true),
        tool("duplicate"),
        tool("rename"),
        tool("delete"),
      ],
    },
    {
      id: "parameters",
      label: "Parâmetros da peça",
      tools: [
        tool("geometry", true),
        tool("loads", true),
        tool("materials", true),
        tool("rebar", true),
      ],
    },
    {
      id: "design",
      label: "Dimensionamento",
      tools: [tool("calculate", true), tool("autodesign"), tool("design")],
    },
  ],
  Exibir: [
    {
      id: "views",
      label: "Vistas",
      tools: [tool("elevation"), tool("section"), tool("three")],
    },
    {
      id: "navigation",
      label: "Navegação do modelo",
      tools: [
        tool("select", true),
        tool("pan", true),
        tool("fit", true),
        tool("zoomIn"),
        tool("zoomOut"),
      ],
    },
    {
      id: "elements",
      label: "Elementos do desenho",
      tools: [tool("dimensions"), tool("steel"), tool("forces"), tool("grid")],
    },
    {
      id: "panels",
      label: "Painéis",
      tools: [tool("browser"), tool("properties"), tool("checks")],
    },
  ],
  Documentação: [
    {
      id: "documents",
      label: "Documentos",
      tools: [
        tool("report", true),
        tool("pieces", true),
        tool("details", true),
      ],
    },
    {
      id: "exports",
      label: "Exportação",
      tools: [
        tool("pdf", true),
        tool("dxf", true),
        tool("svg", true),
        tool("csv", true),
      ],
    },
  ],
  Configurações: [
    {
      id: "general",
      label: "Geral / Aparência",
      description: "Aplicativo · aparência",
      tools: [
        tool("theme"),
        tool("updates"),
        future("general-preferences", "Preferências gerais", SlidersHorizontal),
      ],
    },
    {
      id: "drawing",
      label: "Desenho",
      description: "Vista · elementos do desenho",
      tools: [
        tool("dimensions"),
        tool("steel"),
        tool("forces"),
        tool("grid"),
        future("drawing-colors", "Cores", Palette),
        future("drawing-widths", "Espessuras", PencilLine),
        future("drawing-dimensions", "Estilo de cotas", Ruler),
      ],
    },
    {
      id: "three",
      label: "Modelo 3D",
      description: "Visualização · itens futuros",
      tools: [
        future("three-display", "Preferências de visualização", Box),
        future("three-camera", "Câmera padrão", Camera),
      ],
    },
    {
      id: "design",
      label: "Dimensionamento",
      description: "Padrões futuros e dados da peça",
      tools: [
        future(
          "design-defaults",
          "Padrões gerais de dimensionamento",
          SlidersHorizontal,
        ),
        tool("design"),
        tool("strutLimit"),
        tool("materialSafety"),
        tool("excessConcrete"),
      ],
    },
    {
      id: "detailing",
      label: "Detalhamento",
      description: "Modo das armaduras · itens futuros",
      tools: [
        tool("barArrangement"),
        future("detailing-display", "Padrões de apresentação", Layers3),
        future("detailing-text", "Textos", Type),
        future("detailing-dimensions", "Cotas do detalhamento", Ruler),
        future("detailing-bars", "Identificação de barras", Tag),
      ],
    },
  ],
};
