/* Dados dos treinos. Edite aqui para mudar exercícios, cargas e GIFs.
   Cada exercício: [nome, gif (arquivo em /gifs sem .gif), séries, repetições, carga em kg, intervalo em s, instruções] */
const PLANO = {
  nome: "Abcd - masculino",
  totalSessoes: 50,
  validade: "07/01/2027",
  treinos: [
    {
      id: "A", nome: "A: costa + biceps",
      exercicios: [
        ["Puxada frontal", "puxada-frontal", 3, 12, 45, 60, "Puxe a barra até a altura do queixo, sem balançar o tronco."],
        ["Remada baixa", "remada-baixa", 3, 12, 40, 60, "Mantenha a coluna reta e puxe o pegador até o abdômen."],
        ["Remada máquina", "remada-maquina", 3, 12, 35, 60, "Peito apoiado, cotovelos próximos ao corpo."],
        ["Pulldown na polia", "pulldown", 3, 12, 25, 60, "Braços quase estendidos, desça a barra até as coxas."],
        ["Rosca direta barra", "rosca-direta", 3, 12, 20, 60, "Cotovelos fixos ao lado do corpo."],
        ["Rosca martelo com halter", "rosca-martelo", 3, 12, 10, 60, "Pegada neutra, sem girar o punho."],
        ["Rosca scott máquina", "rosca-scott", 3, 12, 20, 60, "Desça controlando até quase estender o braço."],
      ],
    },
    {
      id: "B", nome: "B: quadriceps",
      exercicios: [
        ["Cadeira extensora", "cadeira-extensora", 3, 12, 52, 60, "A cada repetição segurar por 2seg a cada repetição."],
        ["Leg press 45", "leg-press-45", 3, 12, 80, 60, "Desça até 90° e empurre sem travar os joelhos."],
        ["Agachamento smith", "agachamento-smith", 3, 12, 0, 60, "Pés um pouco à frente da barra, desça até as coxas ficarem paralelas ao chão."],
        ["Cadeira adutora", "cadeira-adutora", 3, 15, 40, 60, "Feche as pernas e volte devagar."],
        ["Panturrilha na máquina sentado", "panturrilha-sentado", 3, 15, 30, 45, "Suba o máximo que conseguir e segure 1seg no topo."],
        ["Panturrilha maquina em pé", "panturrilha-em-pe", 3, 15, 40, 45, "Amplitude completa, sem dobrar os joelhos."],
        ["Prancha", "prancha", 3, 1, 0, 45, "Segure a posição por 30 a 45 segundos com o abdômen contraído."],
        ["Abdominal máquina", "abdominal-maquina", 3, 15, 0, 0, "Enrole o tronco contraindo o abdômen e volte devagar."],
      ],
    },
    {
      id: "C", nome: "C: peito+ombro+triceps",
      exercicios: [
        ["Supino maquina fechado inclinado", "supino-inclinado-maquina", 3, 12, 30, 60, "Empurre sem tirar as costas do encosto."],
        ["Supino reto no banco com halter", "supino-reto-halter", 3, 12, 16, 60, "Desça os halteres até a linha do peito."],
        ["Supino maquina declinado", "supino-declinado-maquina", 3, 12, 30, 60, "Cotovelos a 45° do tronco."],
        ["Crucifixo máquina", "crucifixo-maquina", 3, 12, 35, 60, "Feche os braços à frente do peito e volte controlando."],
        ["Desenvolvimento máquina aberto alternado", "desenvolvimento-maquina", 3, 12, 15, 60, "Suba um braço de cada vez."],
        ["Elevação frontal sentado com halter", "elevacao-frontal", 3, 12, 6, 60, "Eleve até a altura dos ombros."],
        ["Tríceps polia", "triceps-polia", 3, 12, 25, 60, "Cotovelos colados ao corpo, estenda totalmente."],
        ["Tríceps máquina bilateral", "triceps-maquina", 3, 12, 30, 60, "Estenda os dois braços ao mesmo tempo."],
      ],
    },
    {
      id: "D", nome: "D: posterior + gluteo",
      exercicios: [
        ["Cadeira flexora", "cadeira-flexora", 3, 12, 40, 60, "Flexione os joelhos e volte devagar."],
        ["Mesa flexora unilateral", "mesa-flexora", 3, 12, 15, 60, "Uma perna de cada vez, quadril apoiado na mesa."],
        ["Stiff barra", "stiff-barra", 3, 12, 30, 60, "Joelhos levemente flexionados, coluna reta."],
        ["Cadeira abdutora", "cadeira-abdutora", 3, 15, 45, 60, "Abra as pernas e segure 1seg."],
        ["Panturrilha na máquina sentado", "panturrilha-sentado", 3, 15, 30, 45, "Suba o máximo que conseguir e segure 1seg no topo."],
        ["Panturrilha maquina em pé", "panturrilha-em-pe", 3, 15, 40, 45, "Amplitude completa, sem dobrar os joelhos."],
        ["Abdominal máquina", "abdominal-maquina", 3, 15, 0, 0, "Enrole o tronco contraindo o abdômen e volte devagar."],
        ["Prancha", "prancha", 3, 1, 0, 45, "Segure a posição por 30 a 45 segundos com o abdômen contraído."],
      ],
    },
  ],
};
